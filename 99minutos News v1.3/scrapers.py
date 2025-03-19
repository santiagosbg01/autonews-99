import requests
from bs4 import BeautifulSoup
import logging
from datetime import datetime, timedelta
import hashlib
import json
import os
from typing import List, Dict, Any
import re
from fake_useragent import UserAgent
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import time
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from dataclasses import dataclass, asdict
import feedparser
from keywords import keywords, concepts
import random

class ArticleData:
    def __init__(self, title: str, url: str, content: str, date: datetime, source: str):
        self.title = title
        self.url = url
        self.content = content
        self.date = date
        self.source = source
        self.keywords = []
        self.relevance_score = 0  # Higher score means more relevant
        self.linkedin_post = None  # Added linkedin_post attribute

    def to_dict(self):
        return {
            'title': self.title,
            'url': self.url,
            'content': self.content,
            'date': self.date.isoformat(),
            'source': self.source,
            'keywords': self.keywords,
            'relevance_score': self.relevance_score,
            'linkedin_post': self.linkedin_post
        }

class BaseScraper:
    # Business-specific keywords
    BUSINESS_KEYWORDS = {
        'company': [
            '99minutos.com', '99 minutos', 'noventa y nueve minutos',
            'santiago saviñon', 'santiago savinon'
        ],
        'roles': [
            'chief growth officer', 'cgo', 'growth leader', 
            'head of growth', 'growth manager'
        ],
        'growth': [
            'growth b2b', 'growth hacking', 'no code growth',
            'business growth', 'growth strategy', 'growth marketing',
            'customer acquisition', 'user acquisition', 'revenue growth'
        ],
        'industry': [
            'logistics', 'ecommerce', 'e-commerce', 'fulfillment',
            'delivery', 'transport', 'freight', 'supply chain',
            'last mile', 'warehousing', 'distribution', 'shipping',
            'courier', 'parcel delivery', 'logistics tech', 'logtech'
        ],
        'business': [
            'startup', 'scaleup', 'venture capital', 'funding',
            'investment', 'series a', 'series b', 'seed round',
            'b2b', 'b2b sales', 'enterprise sales'
        ],
        'region': [
            'latam', 'latin america', 'mexico', 'mexican market',
            'latinoamerica', 'américa latina', 'méxico'
        ]
    }

    # Combine business-specific and general keywords
    RELEVANT_KEYWORDS = {
        **BUSINESS_KEYWORDS,  # Business-specific keywords
        'general': keywords,  # General keywords from keywords.py
        'concepts': concepts  # Concept variations from keywords.py
    }

    def __init__(self):
        self.base_url = None
        self.cache = {}  # Use an in-memory cache instead of file
        self.driver = None
        self.ua = UserAgent()
        self.SCRAPING_TIMEOUT = 10  # 10 seconds timeout
        self.logger = logging.getLogger(self.__class__.__name__)
        self.setup_chrome_driver()

    def setup_chrome_driver(self):
        """Initialize Chrome WebDriver with basic configuration"""
        options = Options()
        options.add_argument("--headless")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        
        try:
            service = Service()
            self.driver = webdriver.Chrome(options=options)
            logging.info("Chrome WebDriver initialized successfully")
        except Exception as e:
            logging.error(f"Error initializing Chrome WebDriver: {str(e)}")
            raise

    def get_headers(self):
        return {
            'User-Agent': self.ua.random,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        }

    def calculate_relevance_score(self, text: str) -> float:
        """
        Calculate relevance score based on keyword matches.
        More flexible scoring that considers both 99minutos-specific and interesting general content.
        """
        text = text.lower()
        score = 0.0
        matches = []
        
        # First priority: Direct company mentions
        for word in self.BUSINESS_KEYWORDS['company']:
            if word.lower() in text:
                score += 5.0  # Highest score for company mentions
                matches.append(f"company: {word}")
        
        # Second priority: Industry and role relevance
        industry_matches = []
        for word in self.BUSINESS_KEYWORDS['industry']:
            if word.lower() in text:
                score += 2.0
                industry_matches.append(word)
        if industry_matches:
            matches.append(f"industry: {', '.join(industry_matches)}")
        
        for word in self.BUSINESS_KEYWORDS['roles']:
            if word.lower() in text:
                score += 2.0
                matches.append(f"role: {word}")
        
        # Third priority: Growth and business terms
        growth_matches = []
        for word in self.BUSINESS_KEYWORDS['growth']:
            if word.lower() in text:
                score += 1.5
                growth_matches.append(word)
        if growth_matches:
            matches.append(f"growth: {', '.join(growth_matches)}")
        
        business_matches = []
        for word in self.BUSINESS_KEYWORDS['business']:
            if word.lower() in text:
                score += 1.5
                business_matches.append(word)
        if business_matches:
            matches.append(f"business: {', '.join(business_matches)}")
        
        # Fourth priority: Region relevance
        region_matches = []
        for word in self.BUSINESS_KEYWORDS['region']:
            if word.lower() in text:
                score += 1.0
                region_matches.append(word)
        if region_matches:
            matches.append(f"region: {', '.join(region_matches)}")
        
        # General interesting topics (from keywords.py)
        general_matches = []
        for word in keywords:
            if word.lower() in text:
                score += 0.5
                general_matches.append(word)
                if len(general_matches) >= 3:  # If we find 3 or more general matches, it's interesting
                    score += 1.0
        
        # Concept matches (from keywords.py)
        concept_matches = []
        for concept, variations in concepts.items():
            for variation in variations:
                if variation.lower() in text:
                    score += 0.3
                    concept_matches.append(concept)
                    break  # Only count one match per concept
        
        # Bonus points for multiple category matches
        unique_categories = len([m for m in matches if m])
        if unique_categories >= 2:
            score += 1.0  # Bonus for matching multiple categories
        
        if matches:
            logging.debug(f"Matches found: {'; '.join(matches)}")
        
        return score

    def extract_keywords(self, text: str) -> List[str]:
        text = text.lower()
        found_keywords = []
        relevance_score = 0
        
        # Check for each category of keywords
        for category, keywords in self.RELEVANT_KEYWORDS.items():
            category_matches = []
            for keyword in keywords:
                if keyword.lower() in text:
                    category_matches.append(keyword)
                    # Company and role mentions are most important
                    if category in ['company', 'roles']:
                        relevance_score += 5
                    # Growth and industry terms are next
                    elif category in ['growth', 'industry']:
                        relevance_score += 3
                    # Business and region terms are good context
                    else:
                        relevance_score += 2
            
            found_keywords.extend(category_matches)
        
        return found_keywords, relevance_score

    def is_relevant(self, keywords: List[str], score: float) -> bool:
        """
        Determine if an article is relevant based on keywords and score.
        Very flexible criteria that considers both direct relevance and general interest.
        """
        # Case 1: Direct company relevance
        if any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['company']] for word in keywords):
            logging.info("Article relevant: Direct company mention")
            return True
        
        # Case 2: Good relevance score
        if score >= 1.5:  # Lowered from 2.0
            logging.info(f"Article relevant: Good score ({score})")
            return True
        
        # Case 3: Industry or Growth/Business combination
        has_industry = any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['industry']] for word in keywords)
        has_growth = any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['growth']] for word in keywords)
        has_business = any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['business']] for word in keywords)
        has_roles = any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['roles']] for word in keywords)
        
        if has_industry or has_growth or has_business or has_roles:  # Just need one important match
            logging.info("Article relevant: Important category match")
            return True
        
        # Case 4: Multiple matches from any categories
        category_matches = 0
        for category in self.BUSINESS_KEYWORDS:
            if any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS[category]] for word in keywords):
                category_matches += 1
        
        if category_matches >= 1:  # Lowered from 2
            logging.info(f"Article relevant: Multiple category matches ({category_matches})")
            return True
        
        # Case 5: Region relevance
        has_region = any(word.lower() in [k.lower() for k in self.BUSINESS_KEYWORDS['region']] for word in keywords)
        if has_region:
            logging.info("Article relevant: Region match")
            return True
        
        # Case 6: General interesting matches
        general_matches = sum(1 for word in keywords if word.lower() in [k.lower() for k in keywords])
        if general_matches >= 2:  # Lowered from 3
            logging.info(f"Article relevant: Multiple general matches ({general_matches})")
            return True
        
        return False

class FeedlyScraper(BaseScraper):
    def __init__(self):
        super().__init__()
        self.access_token = os.getenv("FEEDLY_ACCESS_TOKEN")
        if not self.access_token:
            logging.error("Feedly access token not found in environment variables")
        self.base_url = "https://cloud.feedly.com/v3"
        self.rate_limit_delay = 1  # Initial delay in seconds
        self.max_retries = 3
        self.user_id = None
        self.max_articles = 10  # Limit to 10 articles
        logging.info(f"FeedlyScraper initialized with token: {'Present' if self.access_token else 'Missing'}")

    def get_feedly_headers(self):
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def handle_rate_limit(self, response):
        # Log rate limit headers if they exist
        rate_limit = response.headers.get('X-RateLimit-Limit')
        rate_remaining = response.headers.get('X-RateLimit-Remaining')
        rate_reset = response.headers.get('X-RateLimit-Reset')
        
        if rate_limit and rate_remaining:
            logging.info(f"Rate limit status: {rate_remaining}/{rate_limit} requests remaining")
            if rate_reset:
                reset_time = datetime.fromtimestamp(int(rate_reset))
                logging.info(f"Rate limit resets at: {reset_time}")
        
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', self.rate_limit_delay))
            logging.warning(f"Rate limited. Waiting {retry_after} seconds...")
            time.sleep(retry_after)
            self.rate_limit_delay *= 2  # Exponential backoff
            return True
        return False

    def get_user_id(self) -> str:
        if self.user_id:
            logging.info(f"Using cached user ID: {self.user_id}")
            return self.user_id

        retries = 0
        while retries < self.max_retries:
            try:
                logging.info("Fetching Feedly user profile...")
                response = requests.get(
                    f"{self.base_url}/profile",
                    headers=self.get_feedly_headers()
                )

                if self.handle_rate_limit(response):
                    retries += 1
                    logging.info(f"Retrying profile fetch (attempt {retries + 1}/{self.max_retries})")
                    continue

                if response.status_code != 200:
                    logging.error(f"Error getting user profile: {response.status_code}")
                    logging.error(f"Response content: {response.text}")
                    return None

                profile_data = response.json()
                self.user_id = profile_data.get('id')
                logging.info(f"Successfully retrieved user ID: {self.user_id}")
                return self.user_id

            except Exception as e:
                logging.error(f"Error getting user profile: {str(e)}")
                retries += 1
                logging.info(f"Retrying profile fetch (attempt {retries + 1}/{self.max_retries})")

        return None

    def list_feeds(self) -> List[Dict]:
        """List all subscribed feeds"""
        try:
            logging.info("Fetching subscribed feeds...")
            response = requests.get(
                f"{self.base_url}/subscriptions",
                headers=self.get_feedly_headers()
            )

            if response.status_code != 200:
                logging.error(f"Error fetching feeds: {response.status_code}")
                logging.error(f"Response content: {response.text}")
                return []

            feeds = response.json()
            for feed in feeds:
                logging.info(f"Found feed: {feed.get('title')} (ID: {feed.get('id')})")
            return feeds

        except Exception as e:
            logging.error(f"Error listing feeds: {str(e)}")
            return []

    def extract_articles(self) -> List[Dict]:
        if not self.access_token:
            logging.error("Feedly access token not found in environment variables")
            return []

        articles = []
        retries = 0
        continuation = None  # For pagination
        max_attempts = 3  # Maximum number of pagination attempts
        current_attempt = 0
        
        try:
            while current_attempt < max_attempts:
                # Use the specific collection ID
                collection_id = "user/e08d791d-b109-450e-8508-3ead28cd2a23/category/77305938-a276-4390-9975-29de684098b6"
                logging.info(f"Using collection ID: {collection_id}")

                # Get feed contents
                url = f"{self.base_url}/streams/contents"
                params = {
                    "streamId": collection_id,
                    "count": 50,  # Number of articles to fetch
                    "ranked": "newest",
                    "similar": "true",
                }
                
                # Add continuation token if we're paginating
                if continuation:
                    params["continuation"] = continuation
                    logging.info(f"Fetching older articles (attempt {current_attempt + 1}/{max_attempts})")
                
                logging.info(f"Fetching feed contents with params: {params}")

                while retries < self.max_retries:
                    response = requests.get(
                        url,
                        headers=self.get_feedly_headers(),
                        params=params
                    )

                    if self.handle_rate_limit(response):
                        retries += 1
                        logging.info(f"Retrying feed fetch (attempt {retries + 1}/{self.max_retries})")
                        continue

                    if response.status_code != 200:
                        logging.error(f"Error fetching Feedly feed: {response.status_code}")
                        logging.error(f"Response content: {response.text}")
                        return []

                    feed_data = response.json()
                    items = feed_data.get("items", [])
                    continuation = feed_data.get("continuation")  # Get continuation token for next page
                    logging.info(f"Retrieved {len(items)} items from collection")
                    
                    # Process all articles
                    all_articles = []
                    cached_count = 0
                    for item in items:
                        try:
                            # Check if article is cached
                            if self.is_article_cached(item.get("originId")):
                                cached_count += 1
                                continue

                            # Extract article content
                            content = item.get("content", {}).get("content", "")
                            if not content:
                                content = item.get("summary", {}).get("content", "")

                            # Clean content from HTML tags
                            if content:
                                soup = BeautifulSoup(content, "html.parser")
                                content = soup.get_text()

                            # Extract keywords and calculate relevance
                            keywords, score = self.extract_keywords(
                                f"{item.get('title', '')} {content}"
                            )

                            article = {
                                'title': item.get('title', ''),
                                'url': item.get('originId', ''),
                                'content': content,
                                'date': datetime.fromtimestamp(item.get('published', 0) / 1000),
                                'source': item.get('origin', {}).get('title', 'Unknown'),
                                'keywords': keywords,
                                'relevance_score': score
                            }
                            all_articles.append(article)

                        except Exception as e:
                            logging.error(f"Error processing article: {str(e)}")
                            continue

                    logging.info(f"Processed {len(all_articles)} new articles ({cached_count} were cached)")

                    # If we found some new articles, process them
                    if all_articles:
                        # First try to find relevant articles
                        relevant_articles = [article for article in all_articles if self.is_relevant(article['keywords'], article['relevance_score'])]
                        
                        if relevant_articles:
                            logging.info(f"Found {len(relevant_articles)} relevant articles")
                            articles = relevant_articles
                        else:
                            # If no relevant articles found, take 7 random ones from non-cached articles
                            logging.info("No relevant articles found, selecting random articles")
                            import random
                            
                            # If we have fewer than 7 new articles, use all of them
                            if len(all_articles) <= 7:
                                articles = all_articles
                                logging.info(f"Using all {len(articles)} available new articles")
                            else:
                                articles = random.sample(all_articles, 7)
                                logging.info(f"Selected 7 random articles from {len(all_articles)} available")
                            
                            for article in articles:
                                logging.info(f"Selected article: {article['title']}")
                        
                        # Cache the selected articles
                        for article in articles:
                            self.cache[article['url']] = article
                            logging.debug(f"Cached article: {article['title']}")
                        
                        # We found articles, so we can stop here
                        break
                    
                    # If all articles were cached and we have a continuation token, try the next page
                    if cached_count == len(items) and continuation:
                        current_attempt += 1
                        logging.info(f"All articles were cached, fetching older articles (page {current_attempt + 1})")
                        break  # Break the retry loop to try the next page
                    else:
                        # Either we found articles or we can't get more
                        break

                # If we found articles, we can stop paginating
                if articles:
                    break

                # If we have no continuation token, we can't get more articles
                if not continuation:
                    logging.warning("No more articles available from Feedly")
                    break

            logging.info(f"Total articles selected: {len(articles)}")
            return articles

        except Exception as e:
            logging.error(f"Error in extract_articles: {str(e)}")
            return []

    def scrape(self) -> List[ArticleData]:
        """Scrape articles from Feedly."""
        try:
            # Get all articles with keywords and relevance scores
            raw_articles = self.extract_articles()
            
            # Randomly select up to max_articles
            if len(raw_articles) > self.max_articles:
                raw_articles = random.sample(raw_articles, self.max_articles)
            
            # Convert to ArticleData objects
            processed_articles = []
            for article_data in raw_articles:
                try:
                    # Create article object
                    article = ArticleData(
                        title=article_data['title'],
                        url=article_data['url'],
                        content=article_data['content'],
                        date=article_data['date'],
                        source=article_data['source']
                    )
                    
                    # Use pre-calculated keywords and relevance score
                    article.keywords = article_data['keywords']
                    article.relevance_score = article_data['relevance_score']
                    
                    processed_articles.append(article)
                    logging.info(f"Added article: {article.title} (Score: {article.relevance_score})")
                        
                except Exception as e:
                    logging.error(f"Error processing article: {str(e)}")
                    continue
            
            return processed_articles
            
        except Exception as e:
            logging.error(f"Error in scrape: {str(e)}")
            return []

    def is_article_cached(self, url: str) -> bool:
        return url in self.cache

    def add_to_cache(self, article):
        self.cache[article['url']] = article

def get_all_scrapers():
    return [FeedlyScraper()]  # Only use Feedly scraper 