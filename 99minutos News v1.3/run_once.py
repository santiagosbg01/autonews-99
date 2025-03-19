import logging
from main import setup_logging, aggregate_news, send_daily_email
from scrapers import get_all_scrapers
import random

def run_once():
    """Run a one-time scrape with 10 random articles."""
    logger = setup_logging()
    logging.info("Starting one-time news aggregation")
    
    # Run aggregation
    aggregate_news()
    
    # Send daily email
    send_daily_email()
    
    logging.info("One-time news aggregation completed")

if __name__ == "__main__":
    run_once() 