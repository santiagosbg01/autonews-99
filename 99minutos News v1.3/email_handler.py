import imaplib
import email
from email.header import decode_header
import logging
from datetime import datetime, timedelta
from typing import List, Dict
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class EmailHandler:
    def __init__(self):
        self.email = os.getenv('EMAIL_USER')
        self.password = os.getenv('APP_PASSWORD')
        self.newsletter_senders = [
            'thevccorner@substack.com',
            'sahil@sahilbloom.com',
            'scott@profgalloway.com'
        ]
        self.imap = None
        
    def connect(self):
        """Connect to email server with error handling."""
        try:
            self.imap = imaplib.IMAP4_SSL('imap.gmail.com')
            self.imap.login(self.email, self.password)
            return True
        except Exception as e:
            logging.warning(f"Could not connect to email server: {str(e)}")
            return False
            
    def fetch_newsletters(self, days_back=7):
        """Fetch newsletters with graceful error handling."""
        newsletters = []
        try:
            if not self.connect():
                logging.info("Skipping email newsletter fetching due to connection issues")
                return newsletters
                
            self.imap.select('inbox')
            date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
            
            for sender in self.newsletter_senders:
                try:
                    _, message_numbers = self.imap.search(None, f'(FROM "{sender}" SINCE "{date}")')
                    
                    for num in message_numbers[0].split():
                        try:
                            _, msg_data = self.imap.fetch(num, '(RFC822)')
                            email_body = msg_data[0][1]
                            email_message = email.message_from_bytes(email_body)
                            
                            subject = email_message['subject'] or 'No Subject'
                            date_str = email_message['date']
                            try:
                                date = datetime.strptime(date_str, "%a, %d %b %Y %H:%M:%S %z")
                            except:
                                date = datetime.now()
                                
                            content = ""
                            if email_message.is_multipart():
                                for part in email_message.walk():
                                    if part.get_content_type() == "text/plain":
                                        content = part.get_payload(decode=True).decode()
                                        break
                            else:
                                content = email_message.get_payload(decode=True).decode()
                                
                            newsletters.append({
                                "title": subject,
                                "url": f"mailto:{sender}?subject={subject}",
                                "content": content,
                                "date": date,
                                "source": f"Email: {sender}"
                            })
                            
                        except Exception as e:
                            logging.error(f"Error processing email message: {str(e)}")
                            continue
                            
                except Exception as e:
                    logging.error(f"Error processing sender {sender}: {str(e)}")
                    continue
                    
        except Exception as e:
            logging.error(f"Error in fetch_newsletters: {str(e)}")
            
        finally:
            self.cleanup()
            
        return newsletters
        
    def cleanup(self):
        """Clean up resources."""
        if self.imap:
            try:
                self.imap.close()
            except:
                pass
            try:
                self.imap.logout()
            except:
                pass
            self.imap = None 

    def send_summary_email(self, stats, articles=None):
        """Send a summary email with run statistics and articles."""
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            
            # Create message
            msg = MIMEMultipart()
            msg['From'] = self.email
            msg['To'] = self.email
            msg['Subject'] = f"99minutos News Digest Summary - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            
            # Create HTML content
            html_content = f"""
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 800px; margin: 0 auto; padding: 20px; }}
                    .header {{ background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }}
                    .stats {{ background-color: #fff; padding: 15px; border: 1px solid #dee2e6; border-radius: 5px; margin-bottom: 20px; }}
                    .article {{ background-color: #fff; padding: 20px; border: 1px solid #dee2e6; border-radius: 5px; margin-bottom: 15px; }}
                    .article h3 {{ margin-top: 0; color: #0066cc; }}
                    .article-meta {{ color: #666; font-size: 0.9em; margin-bottom: 10px; }}
                    .article-content {{ margin-bottom: 10px; }}
                    .article-link {{ color: #0066cc; text-decoration: none; }}
                    .article-link:hover {{ text-decoration: underline; }}
                    .keywords {{ color: #666; font-size: 0.9em; }}
                    .errors {{ background-color: #fff3f3; padding: 15px; border: 1px solid #ffcdd2; border-radius: 5px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>99minutos News Digest Summary</h2>
                        <p>Here are your run statistics and initial article list.</p>
                    </div>

                    <div class="stats">
                        <h3>Run Statistics</h3>
                        <ul>
                            <li><strong>Duration:</strong> {stats.get_duration()}</li>
                            <li><strong>Total Articles Scraped:</strong> {stats.total_articles_scraped}</li>
                            <li><strong>Successfully Processed Articles:</strong> {stats.successful_articles}</li>
                            <li><strong>Articles in Digest:</strong> {stats.articles_in_email}</li>
                        </ul>
                        
                        <h4>Scraper Performance</h4>
                        <ul>
                            {''.join([f"<li><strong>{name}:</strong> {count} articles</li>" for name, count in stats.scraper_stats.items()])}
                        </ul>
                    </div>
            """

            # Add articles section if articles are provided
            if articles:
                html_content += """
                    <div class="articles">
                        <h3>Latest Articles</h3>
                """
                
                for article in articles:
                    # Format date
                    article_date = article['date'].strftime('%Y-%m-%d %H:%M') if isinstance(article['date'], datetime) else str(article['date'])
                    
                    # Format keywords with relevance score
                    keywords_str = ', '.join(article['keywords']) if article.get('keywords') else ''
                    relevance = article.get('relevance_score', 0)
                    
                    html_content += f"""
                        <div class="article">
                            <h3><a href="{article['url']}" class="article-link">{article['title']}</a></h3>
                            <div class="article-meta">
                                <strong>Source:</strong> {article['source']} | <strong>Date:</strong> {article_date}
                            </div>
                            <div class="article-content">
                                {article['content'][:300]}...
                            </div>
                            <div class="keywords">
                                <strong>Keywords:</strong> {keywords_str}
                                <br>
                                <strong>Relevance Score:</strong> {relevance}
                            </div>
                        </div>
                    """
                
                html_content += "</div>"

            # Add errors section
            if stats.errors:
                html_content += """
                    <div class="errors">
                        <h3>Recent Errors</h3>
                        <ul>
                """
                for error in stats.errors[-5:]:  # Show last 5 errors
                    error_time = error['timestamp'].strftime('%Y-%m-%d %H:%M:%S') if isinstance(error['timestamp'], datetime) else str(error['timestamp'])
                    html_content += f"""
                        <li>
                            <strong>{error['source']}</strong> ({error_time})<br>
                            {error['message']}
                        </li>
                    """
                html_content += """
                        </ul>
                    </div>
                """

            html_content += """
                </div>
            </body>
            </html>
            """
            
            msg.attach(MIMEText(html_content, 'html'))
            
            # Send email
            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(self.email, self.password)
                server.send_message(msg)
                
            logging.info("Summary email sent successfully")
            return True
            
        except Exception as e:
            logging.error(f"Error sending summary email: {e}")
            return False 

    def send_digest_email(self, articles):
        """Send a digest email with the latest relevant articles."""
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            
            # Create message
            msg = MIMEMultipart()
            msg['From'] = self.email
            msg['To'] = self.email
            msg['Subject'] = f"99minutos News Digest - {datetime.now().strftime('%Y-%m-%d')}"
            
            # Create HTML content with blue version styling
            html_content = """
            <html>
            <head>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        line-height: 1.6; 
                        color: #333;
                        margin: 0;
                        padding: 0;
                    }
                    .container { 
                        max-width: 800px; 
                        margin: 0 auto; 
                        padding: 20px;
                    }
                    .header { 
                        background-color: #001F3F; 
                        color: white;
                        padding: 30px; 
                        border-radius: 8px; 
                        margin-bottom: 30px;
                        text-align: center;
                    }
                    .header h1 { 
                        margin: 0;
                        font-size: 28px;
                        font-weight: 600;
                    }
                    .header p { 
                        margin: 10px 0 0;
                        opacity: 0.9;
                    }
                    .article { 
                        background-color: #fff; 
                        padding: 25px;
                        border: 1px solid #E9ECEF;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    .article h2 { 
                        margin: 0 0 15px;
                        color: #001F3F;
                        font-size: 22px;
                    }
                    .article-meta { 
                        color: #666;
                        font-size: 0.9em;
                        margin-bottom: 15px;
                        padding-bottom: 15px;
                        border-bottom: 1px solid #E9ECEF;
                    }
                    .article-content { 
                        margin-bottom: 20px;
                        line-height: 1.7;
                        color: #444;
                    }
                    .article-link { 
                        display: inline-block;
                        color: #0066cc;
                        text-decoration: none;
                        font-weight: 500;
                    }
                    .article-link:hover { 
                        text-decoration: underline;
                    }
                    .keywords { 
                        background-color: #F8F9FA;
                        padding: 12px 15px;
                        border-radius: 6px;
                        font-size: 0.9em;
                        color: #666;
                    }
                    .relevance-score {
                        display: inline-block;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 0.85em;
                        font-weight: 500;
                        color: white;
                    }
                    .footer {
                        text-align: center;
                        margin-top: 40px;
                        padding-top: 20px;
                        border-top: 1px solid #E9ECEF;
                        color: #666;
                        font-size: 0.9em;
                    }
                    .button {
                        display: inline-block;
                        padding: 10px 20px;
                        border-radius: 6px;
                        text-decoration: none;
                        font-weight: 500;
                        margin-right: 10px;
                        margin-top: 15px;
                        transition: background-color 0.2s;
                        color: white !important;
                    }
                    .button-primary {
                        background-color: #0066cc;
                    }
                    .button-primary:hover {
                        background-color: #0052a3;
                    }
                    .button-secondary {
                        background-color: #28A745;
                    }
                    .button-secondary:hover {
                        background-color: #218838;
                    }
                    .buttons-container {
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>99minutos News Digest</h1>
                        <p>Your daily curated selection of relevant industry news</p>
                    </div>

                    <div class="articles">
            """
            
            for article in articles:
                # Format date
                article_date = article['date'].strftime('%Y-%m-%d %H:%M') if isinstance(article['date'], datetime) else str(article['date'])
                
                # Determine relevance color
                relevance = article.get('relevance_score', 0)
                if relevance >= 8:
                    relevance_color = '#28A745'  # Green for high relevance
                elif relevance >= 5:
                    relevance_color = '#FFC107'  # Yellow for medium relevance
                else:
                    relevance_color = '#6C757D'  # Gray for lower relevance
                
                # Format keywords
                keywords_str = ', '.join(article['keywords']) if article.get('keywords') else ''
                
                html_content += f"""
                    <div class="article">
                        <h2><a href="{article['url']}" class="article-link">{article['title']}</a></h2>
                        <div class="article-meta">
                            <strong>{article.get('source', 'Unknown Source')}</strong> | {article_date}
                            <span class="relevance-score" style="background-color: {relevance_color}">
                                Relevance: {relevance}
                            </span>
                        </div>
                        <div class="article-content">
                            {article.get('content', '')[:500]}...
                        </div>
                        <div class="keywords">
                            <strong>Key Topics:</strong> {keywords_str}
                        </div>
                        <div class="buttons-container">
                            <a href="{article['url']}" class="button button-primary">Leer artículo completo →</a>
                            {f'<a href="{article["linkedin_post"]}" class="button button-secondary">Ver mi Post para LinkedIn</a>' if article.get("linkedin_post") else ''}
                        </div>
                    </div>
                """
            
            html_content += """
                    </div>
                    <div class="footer">
                        <p>This digest was automatically generated based on your preferences.</p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            msg.attach(MIMEText(html_content, 'html'))
            
            # Send email
            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(self.email, self.password)
                server.send_message(msg)
                
            logging.info("Digest email sent successfully")
            return True
            
        except Exception as e:
            logging.error(f"Error sending digest email: {e}")
            return False 