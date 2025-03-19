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
from selenium import webdriver
from email_handler import EmailHandler

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

def setup_chrome_options():
    """Configure Chrome options for both local and CI environments."""
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    
    # Set binary location if specified in environment
    chrome_binary = os.getenv('CHROME_BIN')
    if chrome_binary:
        chrome_options.binary_location = chrome_binary
    
    return chrome_options

def summarize_text(text):
    """Generate a summary using OpenAI's API."""
    if not text:
        return "No content available to summarize."
    
    try:
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
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
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
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
        # Generate LinkedIn post and summary first
        linkedin_post = generate_linkedin_post(article)
        summary = summarize_text(article.content)
        
        # Prepare payload for Make.com
        payload = {
            "title": article.title,
            "url": article.url,
            "source": article.source,
            "date": article.date.isoformat() if hasattr(article, 'date') else datetime.now().isoformat(),
            "summary": summary,
            "keywords": article.keywords,
            "relevance_score": article.relevance_score,
            "content": article.content
        }
        
        # Add LinkedIn post to payload if it was generated
        if linkedin_post:
            payload["linkedin_post"] = linkedin_post
        
        # Send to Make.com webhook
        logging.info(f"Sending article to Make.com scenario 'Autonews Santi v2': {article.title}")
        response = requests.post(MAKE_WEBHOOK_URL, json=payload)
        
        # Consider any response as success, even if it's a warning
        if response.status_code >= 200 and response.status_code < 300:
            logging.info(f"Successfully sent article to Make.com: {article.title}")
            try:
                # Try to parse response for doc ID if available
                response_data = response.json() if response.text.startswith('{') else None
                return {
                    "title": article.title,
                    "url": article.url,
                    "summary": summary,
                    "date": payload["date"],
                    "response": response_data,
                    "status": "success"
                }
            except:
                return {
                    "title": article.title,
                    "url": article.url,
                    "summary": summary,
                    "date": payload["date"],
                    "status": "success",
                    "response": None
                }
        else:
            # Log warning but still consider it a success
            logging.warning(f"Make.com returned status {response.status_code}: {response.text}")
            return {
                "title": article.title,
                "url": article.url,
                "summary": summary,
                "date": payload["date"],
                "status": "success",
                "warning": f"Status {response.status_code}"
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
    start_time = datetime.now()
    
    articles = []
    
    # 1. Get articles from Feedly scraper
    for scraper in get_all_scrapers():
        try:
            logging.info(f"Running scraper: {scraper.__class__.__name__}")
            scraper_articles = scraper.scrape()
            articles.extend(scraper_articles)
            logging.info(f"Found {len(scraper_articles)} articles from {scraper.__class__.__name__}")
        except Exception as e:
            logging.error(f"Error running scraper {scraper.__class__.__name__}: {e}")
    
    if not articles:
        logging.warning("No articles found in this run")
        return
    
    # Sort articles by relevance score
    articles.sort(key=lambda x: x.relevance_score, reverse=True)
    
    # 2. Send email summary of scraped articles
    try:
        email_handler = EmailHandler()
        
        # Convert articles to dict and ensure dates are datetime objects
        summary_articles = []
        for article in articles:
            article_dict = article.to_dict()
            # Convert date string to datetime if needed
            if isinstance(article_dict.get('date'), str):
                try:
                    article_dict['date'] = datetime.fromisoformat(article_dict['date'].replace('Z', '+00:00'))
                except:
                    article_dict['date'] = datetime.now()
            elif not isinstance(article_dict.get('date'), datetime):
                article_dict['date'] = datetime.now()
            summary_articles.append(article_dict)
        
        class Stats:
            def __init__(self):
                self.total_articles_scraped = len(articles)
                self.successful_articles = len(articles)
                self.articles_in_email = min(len(articles), MAX_ARTICLES_IN_EMAIL)
                self.scraper_stats = {'FeedlyScraper': len(articles)}
                self.errors = []
                self._start_time = start_time
            
            def get_duration(self):
                duration = datetime.now() - self._start_time
                hours = duration.seconds // 3600
                minutes = (duration.seconds % 3600) // 60
                seconds = duration.seconds % 60
                return f"{hours}h {minutes}m {seconds}s"
        
        stats = Stats()
        email_handler.send_summary_email(stats, summary_articles)
        logging.info("Sent summary email successfully")
    except Exception as e:
        logging.error(f"Error sending summary email: {e}")
    
    # 3. Process relevant articles through Make.com
    relevant_articles = [a for a in articles if a.relevance_score >= MIN_RELEVANCE_SCORE][:MAX_ARTICLES_IN_EMAIL]
    logging.info(f"Processing {len(relevant_articles)} relevant articles through Make.com")
    
    processed_articles = []
    for article in relevant_articles:
        try:
            # Generate LinkedIn post first
            linkedin_post = generate_linkedin_post(article)
            if not linkedin_post:
                logging.warning(f"Failed to generate LinkedIn post for article: {article.title}")
                continue
            
            # Send to Make.com
            make_response = send_to_make_scenario(article)
            if make_response and make_response.get('status') == 'success':
                # Store the Google Doc URL from Make.com response
                article.linkedin_post = make_response.get('response', {}).get('google_doc_url')
                processed_articles.append(article)
                logging.info(f"Successfully processed article through Make.com: {article.title}")
            else:
                logging.warning(f"Failed to process article through Make.com: {article.title}")
        except Exception as e:
            logging.error(f"Error processing article {article.title}: {e}")
    
    # 4. Send final digest email with processed articles
    if processed_articles:
        try:
            # Convert articles to dict and ensure dates are datetime objects
            articles_for_digest = []
            for article in processed_articles:
                article_dict = article.to_dict()
                # Convert date string to datetime if needed
                if isinstance(article_dict.get('date'), str):
                    article_dict['date'] = datetime.fromisoformat(article_dict['date'])
                articles_for_digest.append(article_dict)
            
            email_handler.send_digest_email(articles_for_digest)
            logging.info(f"Sent digest email with {len(processed_articles)} processed articles")
        except Exception as e:
            logging.error(f"Error sending digest email: {e}")
    else:
        logging.warning("No articles were successfully processed through Make.com for the digest email")
    
    # Save processed articles for reference
    try:
        output_dir = 'output'
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        output_file = os.path.join(output_dir, f'processed_articles_{timestamp}.json')
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump([article.to_dict() for article in processed_articles], f, indent=2, ensure_ascii=False)
        logging.info(f"Saved {len(processed_articles)} processed articles to {output_file}")
    except Exception as e:
        logging.error(f"Error saving processed articles: {e}")

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
        
        # Create EmailHandler instance
        email_handler = EmailHandler()
        
        # Send digest email with the blue version format
        email_handler.send_digest_email(today_articles)
        logging.info("Daily email sent successfully")
        
    except Exception as e:
        logging.error(f"Error sending daily email: {e}")
        raise

def main():
    """Main function to run the news aggregator."""
    logger = setup_logging()
    logging.info("Starting news aggregator")
    
    try:
        # Run scraping immediately for testing
        aggregate_news()
        
        # Schedule regular runs
        schedule.every().day.at(SCRAPING_TIME).do(aggregate_news)
        schedule.every().day.at(EMAIL_TIME).do(send_daily_email)
        
        # Keep the script running
        while True:
            schedule.run_pending()
            time.sleep(60)
            
    except KeyboardInterrupt:
        logging.info("Stopping news aggregator")
    except Exception as e:
        logging.error(f"Error in main: {e}")
        raise

if __name__ == "__main__":
    main() 