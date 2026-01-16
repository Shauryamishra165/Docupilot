# Docmost AI Service

Python-based AI service using Google Gemini 2.0 Flash for chat functionality.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   - Copy `.env.example` to `.env`
   - Add your Gemini API key to `.env`:
     ```
     GEMINI_API_KEY=your-actual-gemini-api-key
     ```

3. **Run the service:**
   ```bash
   python main.py
   ```
   
   Or with uvicorn directly:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

## API Endpoints

### Health Check
```
GET /health
```

### Chat
```
POST /api/chat
Headers:
  X-API-Key: parth128
Body:
  {
    "messages": [
      {"role": "user", "content": "Hello"},
      {"role": "assistant", "content": "Hi there!"},
      {"role": "user", "content": "What is AI?"}
    ]
  }
```

## Authentication

All API endpoints (except `/health`) require the `X-API-Key` header with value `parth128`.

## Environment Variables

- `API_KEY`: Authentication key for the service (default: "parth128")
- `GEMINI_API_KEY`: Your Google Gemini API key (required)

## Getting Gemini API Key

1. Visit https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Create a new API key
4. Copy the key and add it to your `.env` file

