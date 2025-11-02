markdown

# CryptoMeter - Backend API

A robust NestJS-based backend service for real-time cryptocurrency sentiment analysis, news aggregation, and market psychology tracking. Powered by AI (Google Gemini & LangChain) for intelligent data processing and insights generation.

## 🚀 Features

### Core Functionality

#### 1. **RSS News Scraping**

- Multi-source RSS feed aggregation
- Automated hourly scraping with cron jobs
- Cheerio-based HTML parsing
- Rate limiting and retry mechanisms
- Source reliability tracking

#### 2. **AI-Powered Sentiment Analysis**

- **Hype Index**: Measures market enthusiasm and social buzz
- **FUD Index**: Tracks fear, uncertainty, and doubt levels
- Google Gemini AI integration for natural language processing
- LangChain framework for prompt engineering
- Real-time sentiment scoring (0-100 scale)

#### 3. **Daily Processing Pipeline**

- Article categorization and deduplication
- Sentiment extraction and scoring
- Impactful news identification
- Keyword-based pre-filtering + AI synthesis
- MongoDB storage with optimized schemas

#### 4. **Weekly Analytics**

- **Top Trends**: Highest performing cryptocurrencies
- **Emerging Coins**: Rising stars identification
- **Source Rankings**: Best and worst news sources
- **Weekly Insights**: Comprehensive market analysis
- Automated Sunday processing at 1 AM

#### 5. **Cron Job Automation**

- Scheduled tasks with `@nestjs/schedule`
- Vercel cron integration for production
- Configurable intervals for each job
- Error handling and logging

## 🛠️ Tech Stack

### Framework & Core

- **NestJS 11** - Progressive Node.js framework
- **TypeScript** - Type-safe development
- **MongoDB + Mongoose** - NoSQL database
- **RxJS** - Reactive programming

### AI & NLP

- **@langchain/google-genai** - Google Gemini integration
- **@langchain/core** - LangChain core utilities
- **@langchain/langgraph** - Graph-based AI workflows
- **Zod** - Schema validation for AI outputs

### Scraping & Data

- **Cheerio** - HTML parsing and DOM manipulation
- **RSS Parser** - RSS feed parsing
- **Axios** - HTTP client with retry logic
- **async-retry** - Automatic retry mechanisms
- **p-limit** - Concurrency control

### Utilities

- **class-validator** - DTO validation
- **class-transformer** - Object transformation
- **cache-manager** - Response caching
- **@nestjs/config** - Environment configuration

markdown

## 🔧 Installation

### Prerequisites

- Node.js 18+
- MongoDB Atlas account or local MongoDB
- Google Gemini API key
- CoinGecko API key
- npm/yarn/pnpm

### Setup

**Install dependencies**

```bash
npm install


Environment Configuration

Create a .env file in the root directory:

ini
DATABASE_URL=your_mongodb_connection_string
OPENAI_API_KEY=your_openai_api_key
COINGECKO_API_KEY=your_coingecko_api_key
GOOGLE_API_KEY=your_google_gemini_api_key


Run the application

Development:

bash
npm run start:dev


Production:

bash
npm run build
npm run start:prod
```

## 📊 API Endpoints

Scraper Endpoints
GET /api/scraper/run - Manually trigger RSS scraping
Processor Endpoints
GET /api/processor/hype - Get current hype index data
GET /api/processor/fud - Get current FUD index data
GET /api/processor/weekly-insights - Get weekly market analysis
GET /api/processor/impactful-news - Get categorized impactful news
GET /api/processor/top-sources - Get best and worst news sources
Cron Endpoints (Internal - Triggered by Vercel)
GET /api/cron/pulse - Process articles (Every 2 hours)
GET /api/cron/daily-sentiment - Analyze sentiment (Every 4 hours)
GET /api/cron/impactful-news - Identify impactful news (Every 4 hours)
GET /api/cron/weekly-sources - Rank sources (Sunday 1 AM)
GET /api/cron/weekly-insight - Generate insights (Sunday 1 AM)

## 🤖 AI Processing Pipeline

1. Article Scraping

RSS Feeds → Cheerio Parser → MongoDB Storage

2. Sentiment Analysis

Articles → Keyword Pre-filter → Gemini AI → Sentiment Score → Database

3. Impactful News Detection

Articles → Keyword Scoring → AI Synthesis → Categorization (Positive/Negative)

4. Weekly Insights

Week’s Articles → LangChain Prompt → Gemini Analysis → Top Trends + Emerging Coins

5. Source Ranking

Articles → Accuracy Scoring → Reliability Metrics → Best/Worst Sources

## 📅 Cron Job Schedule

Job Schedule Description
Article Processing Every 2 hours Scrapes and processes new articles
Sentiment Analysis Every 4 hours Analyzes market sentiment
Impactful News Every 4 hours Identifies market-moving news
Source Ranking Sunday 1 AM Ranks news sources weekly
Weekly Insights Sunday 1 AM Generates market insights
RSS Scraping Every hour Fetches new articles from RSS feeds

## 🗄️ Database Schema

Article Schema

Stores scraped articles with title, link, content, source, and categories.

Sentiment Schema

Daily hype and FUD data with scores for each cryptocurrency.

Weekly Insight Schema

Top trends and emerging coins identified by AI analysis.

Source Ranking Schema

Best and worst performing news sources based on accuracy.

Impactful News Schema

Categorized positive and negative market-moving news articles.

## 🔐 Security

Environment Variables
Never commit .env files to version control
Use strong API keys
Rotate secrets regularly
Rate Limiting
Built-in retry mechanisms
Concurrency control with p-limit
Exponential backoff for failed requests
Data Validation
Class-validator for DTOs
Zod schemas for AI outputs
Mongoose schema validation

## 🚀 Deployment

Vercel Deployment
Push your code to GitHub
Connect repository to Vercel
Add environment variables in Vercel dashboard
Create vercel.json for cron job configuration
Deploy
Environment Variables (Production)

Set all required environment variables in Vercel dashboard:

DATABASE_URL
OPENAI_API_KEY
COINGECKO_API_KEY
GOOGLE_API_KEY

## 📈 Performance Optimization

Caching

Response caching with cache-manager for frequently accessed data.

Concurrency

Controlled parallel processing with p-limit for efficient resource usage.

Error Handling

Automatic retry with exponential backoff and comprehensive error logging.

## 🐛 Troubleshooting

MongoDB Connection Issues

Verify your DATABASE_URL is correct and MongoDB Atlas IP whitelist includes your deployment IP.

API Key Errors

Ensure all API keys are valid and have sufficient quota/credits.

Cron Jobs Not Running

Check Vercel logs and verify vercel.json configuration is correct.

## 📚 Documentation

NestJS Documentation
LangChain JS Docs
Google Gemini API
MongoDB Docs

## 📄 License

MIT License

## 📞 Support

For support, contact the development team.

Built with ❤️ for intelligent crypto analysis
