# 99minutos News Aggregator

A news aggregation system that collects, filters, and delivers relevant industry news via email digests.

## Quick Start (READ THIS FIRST)

### Directory Structure
```
/Proyectos Cursor/
└── v1.1/                  # USE THIS DIRECTORY
    ├── main.py           # Main program file
    ├── scrapers.py       # News scraping functionality
    ├── email_handler.py  # Email handling
    ├── config.py         # Configuration settings
    └── .env             # Environment variables
```

### Version to Use
- **ALWAYS USE v1.1 directory** (This contains the latest v1.2 code)
- Do not use v2.1 or other directories
- The version number in the directory (v1.1) differs from the actual version (v1.2) for historical reasons

### Standard Run Command
When asking the AI to "run the News feeder program", it should:
1. Change to the v1.1 directory
2. Activate the virtual environment
3. Run main.py

Example command sequence:
```bash
cd /path/to/Proyectos\ Cursor/v1.1
source .venv/bin/activate
python3 main.py
```

### Expected Behavior
1. Program will start with: "Starting news aggregation process"
2. Will attempt to fetch articles (subject to Feedly API rate limits)
3. Will send email digest if articles are found
4. Will complete with: "News aggregation process completed successfully"

### Common States to Check
1. Feedly API Rate Limit: Resets at 17:59:59 (5:59 PM) daily
2. Gmail App Password: Should be 16 characters without spaces
3. Chrome WebDriver: Will auto-install for your system architecture

## Version History

### V1.2 (Current) - Enhanced Email Digest & Rate Limiting
**Key Updates:**
- Improved email digest format with modern design
- Added dual-button system for articles:
  - "Leer artículo completo →" (blue button)
  - "Ver mi Post para LinkedIn" (green button)
- Integration with Make.com webhook for LinkedIn post drafts
- Optimized Feedly API handling with rate limit management
- More lenient article relevance scoring

**Files Updated:**
1. `email_handler.py`:
   - New `send_digest_email` method with modern HTML template
   - Improved button styling with white text
   - Support for Google Doc URLs from Make.com webhook
   - Separated digest and summary email functionalities

2. `scrapers.py`:
   - Enhanced Feedly scraper with rate limit handling
   - Added exponential backoff system
   - Reduced API calls for better efficiency
   - Updated relevance scoring system
   - Improved error handling and logging

3. `test_digest.py`:
   - New test functionality for digest emails
   - Sample articles with Google Doc URLs
   - Improved test output

### V1.1 - Initial Release
- Basic news aggregation functionality
- Feedly API integration
- Simple email notifications
- Basic article relevance scoring

## Running Instructions

### Prerequisites Check
Before running the program, verify:

1. **Environment Variables**
   ```
   EMAIL_USER=your_email@gmail.com
   APP_PASSWORD=your_16_char_app_password (NO SPACES)
   FEEDLY_ACCESS_TOKEN=your_feedly_token
   ```
   - Gmail App Password remains valid until you:
     - Change your Google Account password
     - Revoke it manually
     - Disable/re-enable 2-Step Verification

2. **Feedly API Limits**
   - Daily limit: 50 requests
   - Reset time: 17:59:59 (5:59 PM) each day
   - Check current status in logs: `logs/news_monitor.log`
   - Plan runs accordingly to avoid rate limits

3. **Chrome WebDriver**
   - Ensure Chrome is installed
   - Program will auto-download correct driver version
   - For M1/M2 Macs (ARM64), driver installs automatically

### Running the Program

1. **First Time Setup**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Regular Run**
   ```bash
   source .venv/bin/activate  # If not already activated
   python3 main.py
   ```

3. **Monitoring**
   - Check `logs/news_monitor.log` for progress
   - Watch for these success messages:
     ```
     "Summary email sent successfully"
     "News aggregation process completed successfully"
     ```
   - Common errors and solutions in Troubleshooting section

### AI Assistant Instructions

When asking for help with this program, use this format:

```
TASK: [Brief description of what you're trying to do]
CURRENT_STATE: 
- Running Version: [v1.1, v1.2, etc.]
- Last Action: [What you just tried]
- Error/Issue: [Any error messages or unexpected behavior]
- Environment: [Local/Production, OS version]

QUESTION: [Specific question or help needed]
```

Example:
```
TASK: Running daily news aggregation
CURRENT_STATE:
- Running Version: v1.2
- Last Action: Executed main.py
- Error/Issue: "Rate limit reached. Will reset at: 2025-03-18 17:59:59"
- Environment: MacOS ARM64

QUESTION: Should I wait for rate limit reset or use cached articles?
```

This format helps the AI assistant:
1. Quickly understand the context
2. Identify the correct version/configuration
3. Provide more accurate solutions
4. Avoid confusion with environment settings

## Setup Instructions

### Environment Variables
```
EMAIL_USER=your_email@gmail.com
APP_PASSWORD=your_gmail_app_password
FEEDLY_ACCESS_TOKEN=your_feedly_token
```

### Dependencies
```
python-dotenv
requests
beautifulsoup4
```

### API Requirements
1. **Feedly API**:
   - Rate limit: 50 requests per day
   - Token required for authentication
   - Handles article fetching from feeds

2. **Gmail**:
   - Requires App Password for authentication
   - Used for sending digest emails

3. **Make.com Integration**:
   - Webhook for LinkedIn post creation
   - Returns Google Doc URLs for drafted posts

## Key Features

### News Aggregation
- Fetches articles from Feedly API
- Filters based on relevance to 99minutos
- Processes content for readability
- Tracks article statistics

### Email Digests
- Modern, responsive HTML design
- Article categorization by relevance
- Direct links to full articles
- Integration with LinkedIn post drafts

### Article Processing
- Relevance scoring system
- Keyword extraction
- Content summarization
- Duplicate detection

## Relevance Scoring

Articles are scored based on keyword categories:
- Company mentions (4 points)
- Industry/growth terms (3 points)
- Business/market terms (2 points)
- Role-related terms (1 point)

Minimum requirements for inclusion:
- Score ≥ 3, OR
- At least 1 category match with score ≥ 1

## Rate Limit Management

Feedly API rate limiting strategy:
- Maximum 50 requests per day
- Exponential backoff on rate limit hits
- Request tracking and monitoring
- Efficient request batching

## Troubleshooting

Common issues and solutions:
1. Rate Limit Exceeded:
   - Wait for reset (usually 24 hours)
   - Check rate limit status in logs
   - Verify token validity

2. Email Sending Issues:
   - Verify APP_PASSWORD is correct
   - Check email credentials
   - Review email logs

3. Article Processing:
   - Check relevance scoring settings
   - Verify feed IDs
   - Monitor error logs

## Maintenance

Regular maintenance tasks:
1. Monitor rate limit usage
2. Check email delivery success rates
3. Review relevance scoring effectiveness
4. Update keywords as needed
5. Clean article cache periodically

## Future Improvements

Planned enhancements:
1. Additional news sources
2. Enhanced content filtering
3. Automated LinkedIn posting
4. Improved article summarization
5. Custom email scheduling

## Contact

For support or questions, contact:
[Your contact information] 