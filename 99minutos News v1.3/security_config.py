"""
ISO 27001 Security Configuration
This module contains security-related configurations and policies.
"""

# Access Control Settings
MAX_LOGIN_ATTEMPTS = 3
PASSWORD_EXPIRY_DAYS = 90
SESSION_TIMEOUT_MINUTES = 30

# Cryptographic Settings
ENCRYPTION_ALGORITHM = 'AES-256-GCM'
KEY_LENGTH = 256
HASH_ALGORITHM = 'SHA-256'

# Network Security
ALLOWED_IPS = ['127.0.0.1']  # Add your allowed IPs
API_RATE_LIMIT = 100  # requests per minute
SSL_VERIFY = True
MIN_TLS_VERSION = 'TLSv1.2'

# Data Retention
LOG_RETENTION_DAYS = 30
BACKUP_RETENTION_DAYS = 90
DATA_CLASSIFICATION = {
    'PUBLIC': 0,
    'INTERNAL': 1,
    'CONFIDENTIAL': 2,
    'RESTRICTED': 3
}

# Security Headers
SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Content-Security-Policy': "default-src 'self'"
}

# Error Messages (Generic for security)
ERROR_MESSAGES = {
    'auth_failed': 'Authentication failed',
    'access_denied': 'Access denied',
    'rate_limit': 'Rate limit exceeded',
    'invalid_input': 'Invalid input provided'
}

# Audit Settings
AUDIT_EVENTS = {
    'user_access': True,
    'data_access': True,
    'configuration_change': True,
    'security_event': True
}

# API Security
API_SECURITY = {
    'max_token_age': 3600,  # 1 hour
    'require_api_key': True,
    'api_key_rotation_days': 90
}

# Data Processing
MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_FILE_TYPES = ['.txt', '.json', '.xml']
INPUT_VALIDATION_PATTERNS = {
    'email': r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
    'url': r'^https?:\/\/[\w\-]+(\.[\w\-]+)+[/#?]?.*$'
} 