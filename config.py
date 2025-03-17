import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# OpenAI API configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Email configuration
EMAIL_SETTINGS = {
    'sender_email': os.getenv("EMAIL_HOST_USER"),
    'app_password': os.getenv("EMAIL_HOST_PASSWORD"),
    'receiver_email': os.getenv("EMAIL_RECIPIENT")
}

# Article settings
MAX_ARTICLES_IN_EMAIL = 25
MIN_RELEVANCE_SCORE = 5

# Schedule settings
SCRAPING_TIME = "10:30"  # Run scraping at 10:30 AM
EMAIL_TIME = "11:30"     # Send email with Google Doc links at 11:30 AM

# Make.com webhook URL
MAKE_WEBHOOK_URL = os.getenv("MAKE_WEBHOOK_URL", "https://hook.us2.make.com/4stsrjxxvjdoctr6n4yrf01f29ihdfvv")

# Storage settings
STORAGE_FILE = "article_docs.json"  # File to store article-doc mappings 