# News Monitor Service

Automated news monitoring service that scrapes articles, processes them through Make.com, and sends daily email digests with Google Doc links.

## Features
- Scheduled article scraping (10:30 AM)
- Make.com integration for article processing
- Daily email digest with Google Doc links (11:30 AM)
- GitHub Actions automated deployment

## Setup Instructions

### 1. Local Development
```bash
# Clone the repository
git clone <your-repo-url>
cd news-monitor

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with your credentials
cp .env.example .env
# Edit .env with your credentials
```

### 2. GitHub Setup

1. Create a new repository on GitHub
2. Add the following secrets in your GitHub repository settings:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `EMAIL_HOST_USER`: Your Gmail address
   - `EMAIL_HOST_PASSWORD`: Your Gmail app password
   - `EMAIL_RECIPIENT`: Recipient email address
   - `MAKE_WEBHOOK_URL`: Your Make.com webhook URL

### 3. Deployment Steps

1. Initialize git in your local project:
```bash
git init
git add .
git commit -m "Initial commit"
```

2. Connect to GitHub:
```bash
git remote add origin https://github.com/yourusername/news-monitor.git
git branch -M main
git push -u origin main
```