import schedule
import time
import yagmail
import logging
import logging.handlers
import sys
import os
import json
import requests
from datetime import datetime
import openai
from config import (
    EMAIL_SETTINGS, 
    OPENAI_API_KEY, 
    SCRAPING_TIME,
    EMAIL_TIME,
    MAX_ARTICLES_IN_EMAIL,
    MIN_RELEVANCE_SCORE,
    MAKE_WEBHOOK_URL,
    STORAGE_FILE
)
from scrapers import get_all_scrapers

def setup_logging():
    """Configure logging."""
    log_format = '%(asctime)s - %(levelname)s - %(message)s'
    
    # Create logs directory if it doesn't exist
    os.makedirs('logs', exist_ok=True)
    
    # File handler with rotation
    file_handler = logging.handlers.RotatingFileHandler(
        'logs/news_monitor.log',
        maxBytes=10485760,  # 10MB
        backupCount=7,      # Keep 7 days of logs
        encoding='utf-8'
    )
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    
    # Set formatter for both handlers
    formatter = logging.Formatter(log_format)
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    # Configure root logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.handlers = []
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

def summarize_text(text):
    """Generate a summary using OpenAI's API."""
    if not text:
        return "No content available to summarize."
    
    try:
        client = openai.OpenAI()
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that summarizes news articles concisely."},
                {"role": "user", "content": f"Please summarize this article in 2-3 sentences, focusing on the most relevant business implications: {text}"}
            ],
            max_tokens=150
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logging.error(f"Error in summarization: {e}")
        return text[:300] + "..."  # Fallback to first 300 chars if summarization fails

def generate_linkedin_post(article):
    """Generate a LinkedIn post for an article using GPT-4."""
    try:
        client = openai.OpenAI()
        prompt = f"""
        Create a compelling LinkedIn post about this article:
        Title: {article.title}
        Summary: {article.content[:500]}...
        Keywords: {', '.join(article.keywords)}
        
        The post should:
        1. Be professional and engaging
        2. Include relevant hashtags
        3. Be between 100-150 words
        4. Highlight business implications
        5. End with a call to action to read the article
        6. Include 3-5 most relevant hashtags from the keywords
        
        Format the post ready to copy-paste to LinkedIn.
        """
        
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a professional growth and business leader creating engaging LinkedIn content."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logging.error(f"Error generating LinkedIn post: {e}")
        return None

def send_to_make_scenario(article):
    """Send article directly to Make.com webhook and return the response for tracking."""
    try:
        # Generate LinkedIn post
        linkedin_post = generate_linkedin_post(article)
        if linkedin_post:
            article.linkedin_post = linkedin_post
        
        # Add summary
        article.summary = summarize_text(article.content)
        
        # Prepare payload for Make.com
        payload = {
            "title": article.title,
            "url": article.url,
            "source": article.source,
            "date": article.date.isoformat() if hasattr(article, 'date') else datetime.now().isoformat(),
            "summary": article.summary,
            "linkedin_post": article.linkedin_post,
            "keywords": article.keywords,
            "relevance_score": article.relevance_score,
            "content": article.content
        }
        
        # Send to Make.com webhook
        logging.info(f"Sending article to Make.com scenario 'Autonews Santi v2': {article.title}")
        response = requests.post(MAKE_WEBHOOK_URL, json=payload)
        
        if response.status_code == 200 or response.status_code == 202:
            logging.info(f"Successfully sent article to Make.com: {article.title}")
            try:
                # Try to parse response for doc ID if available
                response_data = response.json() if response.text.startswith('{') else None
                return {
                    "title": article.title,
                    "url": article.url,
                    "summary": article.summary,
                    "date": payload["date"],
                    "response": response_data,
                    "status": "success"
                }
            except:
                return {
                    "title": article.title,
                    "url": article.url,
                    "summary": article.summary,
                    "date": payload["date"],
                    "status": "success",
                    "response": None
                }
        else:
            logging.error(f"Make.com request failed with status {response.status_code}: {response.text}")
            return {
                "title": article.title,
                "url": article.url,
                "status": "error",
                "error": f"Status {response.status_code}"
            }
            
    except Exception as e:
        logging.error(f"Error sending article to Make.com: {str(e)}")
        return {
            "title": article.title,
            "url": article.url,
            "status": "error",
            "error": str(e)
        }

def load_article_docs():
    """Load stored article-doc mappings."""
    try:
        if os.path.exists(STORAGE_FILE):
            with open(STORAGE_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        logging.error(f"Error loading article docs: {e}")
    return {}

def save_article_docs(data):
    """Save article-doc mappings."""
    try:
        with open(STORAGE_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logging.error(f"Error saving article docs: {e}")

def aggregate_news():
    """Main function to aggregate and process news."""
    logging.info(f"Starting news aggregation at {datetime.now()}")
    
    articles = []
    
    # Get articles from all scrapers
    for scraper in get_all_scrapers():
        try:
            logging.info(f"Running scraper: {scraper.__class__.__name__}")
            scraper_articles = scraper.scrape()
            articles.extend(scraper_articles)
            logging.info(f"Found {len(scraper_articles)} relevant articles from {scraper.__class__.__name__}")
        except Exception as e:
            logging.error(f"Error running scraper {scraper.__class__.__name__}: {e}")
    
    if articles:
        # Sort articles by relevance score
        articles.sort(key=lambda x: x.relevance_score, reverse=True)
        articles = [a for a in articles if a.relevance_score >= MIN_RELEVANCE_SCORE][:MAX_ARTICLES_IN_EMAIL]
        
        # Send articles to Make.com and store results
        results = []
        for article in articles:
            result = send_to_make_scenario(article)
            if result:
                results.append(result)
        
        # Save results for email processing
        today = datetime.now().strftime('%Y-%m-%d')
        article_docs = load_article_docs()
        article_docs[today] = results
        save_article_docs(article_docs)
        
        logging.info(f"Processed {len(results)} articles")
    else:
        logging.warning("No articles found in this run")

def send_daily_email():
    """Send daily email with Google Doc links."""
    logging.info("Preparing daily email rollup")
    
    try:
        # Load today's articles
        today = datetime.now().strftime('%Y-%m-%d')
        article_docs = load_article_docs()
        today_articles = article_docs.get(today, [])
        
        if not today_articles:
            logging.warning("No articles found for today's email")
            return
        
        # Prepare email content
        email_html = """
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; }
                .article { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
                .title { font-size: 18px; font-weight: bold; color: #333; }
                .summary { color: #666; margin: 10px 0; }
                .links { margin-top: 10px; }
                .button {
                    display: inline-block;
                    padding: 8px 15px;
                    background-color: #0077b5;
                    color: white;
                    text-decoration: none;
                    border-radius: 4px;
                    margin-right: 10px;
                }
            </style>
        </head>
        <body>
            <h2>Daily News Roundup - {date}</h2>
        """.format(date=datetime.now().strftime('%B %d, %Y'))
        
        for article in today_articles:
            doc_link = None
            if article.get("response") and isinstance(article["response"], dict):
                doc_link = article["response"].get("doc_url") or article["response"].get("doc_id")
            
            email_html += """
            <div class="article">
                <div class="title">{title}</div>
                <div class="summary">{summary}</div>
                <div class="links">
                    <a href="{url}" class="button">Read Original</a>
                    {doc_button}
                </div>
            </div>
            """.format(
                title=article["title"],
                summary=article.get("summary", ""),
                url=article["url"],
                doc_button=f'<a href="{doc_link}" class="button">View Document</a>' if doc_link else ''
            )
        
        email_html += """
        </body>
        </html>
        """
        
        # Send email
        yag = yagmail.SMTP(EMAIL_SETTINGS['sender_email'], EMAIL_SETTINGS['app_password'])
        yag.send(
            to=EMAIL_SETTINGS['receiver_email'],
            subject=f"Daily News Roundup - {datetime.now().strftime('%B %d, %Y')}",
            contents=email_html
        )
        
        logging.info("Daily email sent successfully")
        
    except Exception as e:
        logging.error(f"Error sending daily email: {e}")

def main():
    """Main function to start the news monitor service."""
    setup_logging()
    logging.info("Starting News Monitor Service V2.1")
    logging.info(f"Scheduled scraping at {SCRAPING_TIME}")
    logging.info(f"Scheduled email at {EMAIL_TIME}")
    
    # Schedule daily runs
    schedule.every().day.at(SCRAPING_TIME).do(aggregate_news)
    schedule.every().day.at(EMAIL_TIME).do(send_daily_email)
    
    # Run initial aggregation if starting before email time
    current_time = datetime.now().strftime("%H:%M")
    if current_time < EMAIL_TIME:
        logging.info("Running initial aggregation...")
        aggregate_news()
    
    # Keep the script running
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == "__main__":
    main() 