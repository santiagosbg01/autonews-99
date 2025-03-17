import requests
from bs4 import BeautifulSoup
import logging
from datetime import datetime, timedelta
import hashlib
import json
import os
from typing import List, Dict
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

class ArticleData:
    def __init__(self, title: str, url: str, content: str, date: datetime, source: str):
        self.title = title
        self.url = url
        self.content = content
        self.date = date
        self.source = source
        self.keywords = []
        self.relevance_score = 0  # Higher score means more relevant

    def to_dict(self):
        return {
            'title': self.title,
            'url': self.url,
            'content': self.content,
            'date': self.date.isoformat(),
            'source': self.source,
            'keywords': self.keywords,
            'relevance_score': self.relevance_score
        }

class BaseScraper:
    RELEVANT_KEYWORDS = {
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

    def __init__(self):
        self.cache_file = 'article_cache.json'
        self.ua = UserAgent()
        self.SCRAPING_TIMEOUT = 10  # 10 seconds timeout
        self.load_cache()
        self.setup_driver()

    def get_headers(self):
        return {
            'User-Agent': self.ua.random,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        }

    def get_selenium_driver(self):
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument(f'user-agent={self.ua.random}')
        service = Service(ChromeDriverManager().install())
        return webdriver.Chrome(service=service, options=chrome_options)

    def load_cache(self):
        if os.path.exists(self.cache_file):
            with open(self.cache_file, 'r') as f:
                self.cache = json.load(f)
        else:
            self.cache = {}

    def save_cache(self):
        with open(self.cache_file, 'w') as f:
            json.dump(self.cache, f)

    def is_article_cached(self, url: str) -> bool:
        return url in self.cache

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
                        relevance_score += 1
            
            found_keywords.extend(category_matches)
        
        return found_keywords, relevance_score

    def is_relevant(self, keywords: List[str], score: int) -> bool:
        # Article is relevant if it has keywords and meets minimum score threshold
        return len(keywords) > 0 and score >= 2

    def setup_driver(self):
        self.driver = self.get_selenium_driver()

    def wait_for_element(self, by, value, timeout=5):
        """Wait for element with timeout."""
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return element
        except TimeoutException:
            logging.warning(f"Timeout waiting for element {value}")
            return None

    def scrape_with_timeout(self, url):
        """Scrape with timeout protection."""
        start_time = time.time()
        try:
            self.driver.get(url)
            while time.time() - start_time < self.SCRAPING_TIMEOUT:
                # If page is ready, start scraping
                if self.driver.execute_script("return document.readyState") == "complete":
                    return True
                time.sleep(0.5)
            logging.warning(f"Timeout reached for {url}, moving to next site")
            return False
        except Exception as e:
            logging.error(f"Error loading {url}: {str(e)}")
            return False

    def scrape(self):
        """Base scrape method with timeout."""
        try:
            if not self.scrape_with_timeout(self.base_url):
                logging.warning(f"Skipping {self.__class__.__name__} due to timeout")
                return []
            
            articles = self.extract_articles()
            if not articles:
                logging.info(f"No articles found for {self.__class__.__name__}")
                return []
                
            return articles
            
        except Exception as e:
            logging.error(f"Error in {self.__class__.__name__}: {str(e)}")
            return []
        finally:
            try:
                self.driver.quit()
            except:
                pass

class ForbesMexicoScraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        urls = [
            'https://forbes.com.mx/negocios/',
            'https://forbes.com.mx/emprendedores/'
        ]
        
        for url in urls:
            try:
                logging.info(f"Scraping Forbes Mexico section: {url}")
                self.base_url = url
                self.scrape_with_timeout(url)
                
                soup = BeautifulSoup(self.driver.page_source, 'lxml')
                article_elements = soup.find_all('article', class_='article-preview')
                
                if not article_elements:
                    article_elements = soup.find_all('div', class_='article-card')  # Alternative class
                
                for article in article_elements:
                    try:
                        # Find link - handle multiple possible structures
                        link_element = article.find('a', href=True)
                        if not link_element:
                            continue
                            
                        link = link_element['href']
                        if 'suscripciones.forbes' in link:  # Skip subscription links
                            continue
                            
                        if not link.startswith('http'):
                            link = 'https://forbes.com.mx' + link
                            
                        if self.is_article_cached(link):
                            continue
                            
                        article_data = self.scrape_article(link)
                        if article_data:
                            articles.append(article_data)
                            self.cache[link] = article_data.to_dict()
                            logging.info(f"Successfully scraped Forbes article: {link}")
                    except Exception as e:
                        logging.error(f"Error processing Forbes article listing: {str(e)}")
                        continue
                        
            except Exception as e:
                logging.error(f"Error scraping Forbes Mexico section {url}: {str(e)}")
                
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            self.scrape_with_timeout(url)
            time.sleep(2)  # Wait for content to load
            
            # Check for paywall
            if any(text in self.driver.page_source.lower() for text in ['suscríbete', 'subscribe', 'inicia sesión']):
                logging.info(f"Skipping paywalled article: {url}")
                return None
                
            soup = BeautifulSoup(self.driver.page_source, 'lxml')
            
            # Try multiple possible title locations
            title = None
            for title_class in ['article-title', 'entry-title', 'post-title']:
                title_elem = soup.find(['h1', 'h2'], class_=title_class)
                if title_elem:
                    title = title_elem.text.strip()
                    break
                    
            if not title:
                title_elem = soup.find('h1')
                title = title_elem.text.strip() if title_elem else None
                
            if not title:
                return None
                
            # Try multiple possible content locations
            content = None
            for content_class in ['article-body', 'entry-content', 'post-content']:
                content_elem = soup.find('div', class_=content_class)
                if content_elem:
                    content = content_elem.text.strip()
                    break
                    
            if not content:
                return None
                
            # Try to find the publication date
            date = None
            date_elem = soup.find('time')
            if date_elem:
                try:
                    date_str = date_elem.get('datetime', date_elem.text)
                    date = datetime.strptime(date_str[:19], '%Y-%m-%dT%H:%M:%S')
                except:
                    date = datetime.now()
            else:
                date = datetime.now()
                
            article = ArticleData(
                title=title,
                url=url,
                content=content,
                date=date,
                source="Forbes México"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(f"{title} {content}")
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping Forbes article {url}: {str(e)}")
            return None

class BloombergLineaScraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        url = 'https://www.bloomberglinea.com/mexico/'  # Updated URL
        
        try:
            logging.info(f"Starting Bloomberg Linea scraper with URL: {url}")
            self.base_url = url
            self.scrape_with_timeout(url)
            
            # Scroll a few times to load more content
            for _ in range(3):
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)
            
            soup = BeautifulSoup(self.driver.page_source, 'lxml')
            article_elements = soup.find_all(['article', 'div'], class_=['article-card', 'post-card'])
            
            logging.info(f"Found {len(article_elements)} potential articles on Bloomberg Linea")
            
            for article in article_elements:
                try:
                    link_elem = article.find('a', href=True)
                    if not link_elem:
                        continue
                        
                    link = link_elem['href']
                    if not link.startswith('http'):
                        link = 'https://www.bloomberglinea.com' + link
                        
                    if self.is_article_cached(link):
                        continue
                        
                    article_data = self.scrape_article(link)
                    if article_data:
                        articles.append(article_data)
                        self.cache[link] = article_data.to_dict()
                        logging.info(f"Successfully scraped Bloomberg article: {link}")
                except Exception as e:
                    logging.error(f"Error processing Bloomberg article listing: {str(e)}")
                    continue
                    
        except Exception as e:
            logging.error(f"Error scraping Bloomberg Linea: {str(e)}")
            
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            self.scrape_with_timeout(url)
            time.sleep(3)  # Wait for content to load
            
            # Check for paywall/subscription wall
            if any(text in self.driver.page_source.lower() for text in ['subscribe', 'suscríbete', 'registro']):
                logging.info(f"Skipping paywalled article: {url}")
                return None
                
            soup = BeautifulSoup(self.driver.page_source, 'lxml')
            
            # Try multiple possible title locations
            title = None
            for title_tag in ['h1', 'h2']:
                title_elem = soup.find(title_tag)
                if title_elem:
                    title = title_elem.text.strip()
                    break
                    
            if not title:
                return None
                
            # Try multiple possible content locations
            content = None
            for content_class in ['article-body', 'post-content', 'entry-content']:
                content_elem = soup.find(['div', 'article'], class_=content_class)
                if content_elem:
                    # Remove unwanted elements
                    for unwanted in content_elem.find_all(['script', 'style', 'iframe']):
                        unwanted.decompose()
                    content = content_elem.text.strip()
                    break
                    
            if not content:
                return None
                
            # Try to find the publication date
            date = None
            date_elem = soup.find('time')
            if date_elem:
                try:
                    date_str = date_elem.get('datetime', date_elem.text)
                    date = datetime.strptime(date_str[:19], '%Y-%m-%dT%H:%M:%S')
                except:
                    date = datetime.now()
            else:
                date = datetime.now()
                
            article = ArticleData(
                title=title,
                url=url,
                content=content,
                date=date,
                source="Bloomberg Línea"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(f"{title} {content}")
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping Bloomberg article {url}: {str(e)}")
            return None

class MundoEjecutivoScraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        url = 'https://mundoejecutivo.com.mx/'
        
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            for article in soup.find_all('article'):
                try:
                    link = article.find('a')['href']
                    if self.is_article_cached(link):
                        continue
                        
                    article_data = self.scrape_article(link)
                    if article_data:
                        articles.append(article_data)
                        self.cache[link] = article_data.to_dict()
                except Exception as e:
                    logging.error(f"Error processing Mundo Ejecutivo article: {e}")
                    
        except Exception as e:
            logging.error(f"Error scraping Mundo Ejecutivo: {e}")
            
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            title = soup.find('h1').text.strip()
            content = soup.find('div', class_='entry-content')
            if not content:
                return None
                
            article = ArticleData(
                title=title,
                url=url,
                content=content.text.strip(),
                date=datetime.now(),
                source="Mundo Ejecutivo"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(article.content)
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping Mundo Ejecutivo article {url}: {e}")
            return None

class ContxtoScraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        url = 'https://contxto.com/es/'
        
        try:
            self.base_url = url
            self.scrape_with_timeout(url)
            
            soup = BeautifulSoup(self.driver.page_source, 'lxml')
            for article in soup.find_all('article'):
                try:
                    link = article.find('a')['href']
                    if self.is_article_cached(link):
                        continue
                        
                    article_data = self.scrape_article(link)
                    if article_data:
                        articles.append(article_data)
                        self.cache[link] = article_data.to_dict()
                except Exception as e:
                    logging.error(f"Error processing Contxto article: {e}")
            
        except Exception as e:
            logging.error(f"Error scraping Contxto: {e}")
            
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            title = soup.find('h1').text.strip()
            content = soup.find('div', class_='entry-content')
            if not content:
                return None
                
            article = ArticleData(
                title=title,
                url=url,
                content=content.text.strip(),
                date=datetime.now(),
                source="Contxto"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(article.content)
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping Contxto article {url}: {e}")
            return None

class StartupsLatamScraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        url = 'https://startupslatam.com/noticias/'
        
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            for article in soup.find_all('article'):
                try:
                    link = article.find('a')['href']
                    if self.is_article_cached(link):
                        continue
                        
                    article_data = self.scrape_article(link)
                    if article_data:
                        articles.append(article_data)
                        self.cache[link] = article_data.to_dict()
                except Exception as e:
                    logging.error(f"Error processing StartupsLatam article: {e}")
                    
        except Exception as e:
            logging.error(f"Error scraping StartupsLatam: {e}")
            
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            title = soup.find('h1').text.strip()
            content = soup.find('div', class_='post-content')
            if not content:
                return None
                
            article = ArticleData(
                title=title,
                url=url,
                content=content.text.strip(),
                date=datetime.now(),
                source="Startups Latam"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(article.content)
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping StartupsLatam article {url}: {e}")
            return None

class T21Scraper(BaseScraper):
    def scrape(self) -> List[ArticleData]:
        articles = []
        url = 'https://t21.com.mx/category/logistica/'
        
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            for article in soup.find_all('article'):
                try:
                    link = article.find('a')['href']
                    if not link.startswith('http'):
                        link = 'https://t21.com.mx' + link
                    if self.is_article_cached(link):
                        continue
                        
                    article_data = self.scrape_article(link)
                    if article_data:
                        articles.append(article_data)
                        self.cache[link] = article_data.to_dict()
                except Exception as e:
                    logging.error(f"Error processing T21 article: {e}")
                    
        except Exception as e:
            logging.error(f"Error scraping T21: {e}")
            
        self.save_cache()
        return articles

    def scrape_article(self, url: str) -> ArticleData:
        try:
            response = requests.get(url, headers=self.get_headers())
            soup = BeautifulSoup(response.text, 'lxml')
            
            title = soup.find('h1').text.strip()
            content = soup.find('div', class_='node-content')
            if not content:
                return None
                
            article = ArticleData(
                title=title,
                url=url,
                content=content.text.strip(),
                date=datetime.now(),
                source="T21"
            )
            
            article.keywords, article.relevance_score = self.extract_keywords(article.content)
            return article if self.is_relevant(article.keywords, article.relevance_score) else None
            
        except Exception as e:
            logging.error(f"Error scraping T21 article {url}: {e}")
            return None

def get_all_scrapers():
    return [
        ForbesMexicoScraper(),
        BloombergLineaScraper(),
        MundoEjecutivoScraper(),
        ContxtoScraper(),
        StartupsLatamScraper(),
        T21Scraper()
    ] 