# Hybrid RAG System - Complete Setup Guide
## Research Paper Knowledge Base with Semantic Search + Knowledge Graph

---
## Quick Start (TL;DR)

```bash
# 1. Clone and setup
git clone https://github.com/your-repo/ai-knowledge-platform.git
cd ai-knowledge-platform

# 2. Setup Python backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 3. Setup frontend
cd frontend && npm install && cd ..

# 4. Configure environment files
cp .env.example .env
cp frontend/.env.example frontend/.env
# Edit .env and set your NEO4J_PASS

# 5. Install and start Ollama LLM
ollama pull llama3.2

# 6. Start Neo4j Desktop and create/start a database

# 7. Run the application (2 terminals)
# Terminal 1 - Backend:
python app.py

# Terminal 2 - Frontend:
cd frontend && npm start
```

**macOS Users:** Port 5000 is used by AirPlay Receiver. See [macOS Port 5000 Issue](#issue-macos-port-5000-already-in-use) for the fix.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running the System](#running-the-system)
5. [Using the Web Interface](#using-the-web-interface)
6. [Troubleshooting](#troubleshooting)
7. [Project Structure](#project-structure)

---

## What This System Does

Upload your research papers (Excel/CSV) and ask questions in natural language. The system combines:
- **Semantic Search**: Finds papers by content similarity
- **Knowledge Graph**: Discovers relationships between authors, papers, and topics
- **AI-Powered Answers**: Uses local LLM to synthesize responses with source citations

---

## 📦 Prerequisites

### Required Software

1. **Python 3.9+**
   - Download: https://www.python.org/downloads/
   - ✅ Check: `python --version`

2. **Node.js 16+** (for frontend)
   - Download: https://nodejs.org/
   - ✅ Check: `node --version`

3. **Neo4j Desktop**
   - Download: https://neo4j.com/download/
   - Create a local database
   - Remember your password!

4. **Ollama** (Local LLM)
   - Download: https://ollama.ai/download
   - ✅ Check: `ollama --version`

---

## ⚙️ Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-repo/ai-knowledge-platform.git
cd ai-knowledge-platform
```

### Step 2: Create Python Virtual Environment

```bash
# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate

# macOS/Linux:
source venv/bin/activate
```

### Step 3: Install Python Dependencies

```bash
# Upgrade pip
pip install --upgrade pip

# Install all dependencies
pip install -r requirements.txt

# Download spaCy language model
python -m spacy download en_core_web_sm
```

### Step 4: Install Ollama Model

```bash
# Pull the LLM model (3B parameters, ~2GB)
ollama pull llama3.2

# Verify it's installed
ollama list
```

### Step 5: Setup Frontend

```bash
# Navigate to frontend folder
cd frontend

# Install Node dependencies
npm install

# Go back to project root
cd ..
```

---

## Configuration

### 1. Configure Neo4j

**Open Neo4j Desktop:**

1. Click **"+ New"** → **"Create Project"**
2. Click **"Add"** → **"Local DBMS"**
3. Name it: `research-papers` (or any name)
4. Set password and **remember it**
5. Click **"Create"**
6. Click **"Start"** to run the database

**Note the connection details:**
- URL: `bolt://localhost:7687` (or `neo4j://localhost:7687`)
- Username: `neo4j`
- Password: `[your password]`

### 2. Configure Environment Variables

The application uses `.env` files for configuration. Copy the example files and edit them:

```bash
# Backend configuration
cp .env.example .env

# Frontend configuration
cp frontend/.env.example frontend/.env
```

**Edit `.env`** (in project root) and set your Neo4j password:

```bash
# Flask server port (use 5001 on macOS, see troubleshooting)
FLASK_PORT=5000

# Neo4j database connection
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASS=your_actual_password_here  # <-- CHANGE THIS!
```

**Edit `frontend/.env`** to match your backend port:

```bash
# Backend API URL (must match FLASK_PORT above)
REACT_APP_API_URL=http://localhost:5000
```

**Important:** Both ports must match! If backend runs on 5001, frontend must point to 5001.

---

## Running the System

### Terminal 1: Start Backend (Flask API)

```bash
# Make sure you're in project root and venv is activated
source venv/bin/activate  # Windows: venv\Scripts\activate

# Start the backend
python app.py
```

You should see:
```
============================================================
         HYBRID RAG API SERVER
         Automatic Neo4j Import + Web Interface
============================================================

Starting server on http://localhost:5000
```

**macOS Users:** If you see "Address already in use" for port 5000, see the [troubleshooting section](#issue-macos-port-5000-already-in-use).

### Terminal 2: Start Frontend (React)

Open a **new terminal**:

```bash
# Navigate to frontend
cd frontend

# Start React development server
npm start
```

Your browser should automatically open to **http://localhost:3000**

---

## 🎨 Using the Web Interface

### Step 1: Upload Research Papers

1. Click **"Choose File"** or drag & drop
2. Select your Excel/CSV file
3. Wait for processing (~30-60 seconds)
   - ✅ Data validation
   - ✅ Vector embeddings creation
   - ✅ Knowledge graph import to Neo4j
4. See "✅ System ready!" message

**Required Excel/CSV Columns:**
- `title` - Paper title
- `abstract` - Paper abstract
- `authors` - Author names (semicolon-separated)
- `doi` - Digital Object Identifier
- `date` - Publication year
- `journal_name` - Journal name
- `source` - Source database

**Optional Columns:**
- `url` - Paper URL
- `citations` - Citation count
- `sources` - Keywords/topics

### Step 2: Ask Questions

**Example Questions:**

**Semantic Search (Content-based):**
- "What is customer experience management?"
- "Explain the relationship between loyalty and satisfaction"
- "What are the main findings on AI in marketing?"

**Knowledge Graph (Relationship-based):**
- "Which papers were written by Klaus?"
- "Who collaborated with Maklan?"
- "Show me authors with multiple papers"

**Hybrid (Best Results):**
- "What did Klaus write about service quality?"
- "Which authors researched AI and marketing together?"

### Step 3: View Results

Results include:
- **Answer**: AI-generated summary
- **Confidence Score**: How relevant the results are
- **Sources**: Papers used with similarity scores
- **Graph Query**: Cypher query if knowledge graph was used

---

## Troubleshooting

### Issue: macOS Port 5000 Already in Use

**Symptom:** When starting the backend, you see:
```
Address already in use
Port 5000 is in use by another program.
```

**Cause:** macOS Monterey and later use port 5000 for AirPlay Receiver.

**Solution:** Use port 5001 instead. Update both config files:

1. **Edit `.env`** (backend):
```bash
FLASK_PORT=5001
```

2. **Edit `frontend/.env`**:
```bash
REACT_APP_API_URL=http://localhost:5001
```

3. **Restart both servers** (frontend needs restart to pick up .env changes)

**Alternative:** Disable AirPlay Receiver in System Settings > General > AirDrop & Handoff > AirPlay Receiver.

---

### Issue: "Failed to process file: WinError 32"

**Solution:** Database is locked

```bash
# Stop Flask (Ctrl+C)
# Delete locked database
# Windows:
Remove-Item -Path research_index_db -Recurse -Force

# macOS/Linux:
rm -rf research_index_db

# Restart Flask
python app.py
```

---

### Issue: "Couldn't connect to localhost:7687"

**Solution:** Neo4j is not running

1. Open **Neo4j Desktop**
2. Find your database
3. Click **"Start"**
4. Wait until it shows **"Active"** (green)
5. Try uploading again

---

### Issue: "Module 'flask' not found"

**Solution:** Virtual environment not activated or dependencies not installed

```bash
# Activate venv
venv\Scripts\activate  # Windows
source venv/bin/activate  # Mac/Linux

# Install dependencies
pip install -r requirements.txt
```

---

### Issue: Frontend shows "Failed to fetch"

**Solution:** Backend is not running

```bash
# Check if Flask is running
# You should see it in Terminal 1

# If not, start it:
python app.py
```

---

### Issue: "Ollama model not found"

**Solution:** LLM model not installed

```bash
# Install the model
ollama pull llama3.2

# Verify
ollama list
```

---

### Issue: Slow Answer Generation (>30 seconds)

**Solution:** Use faster model

Edit `app.py` (line 179):

```python
# Change from:
llm_model="llama3.2"

# To faster model:
llm_model="llama3.2:1b"  # Much faster, slightly lower quality
```

---

## 📁 Project Structure

```
ai-knowledge-platform/
├── backend/
│   ├── __init__.py          # Python package marker
│   ├── etl.py              # Data processing & Neo4j export
│   └── search.py           # Hybrid search engine
│
├── frontend/               # React web interface
│   ├── public/
│   │   └── index.html     # Main HTML (with Tailwind CDN)
│   ├── src/
│   │   ├── App.js         # Main React component
│   │   └── index.js       # React entry point
│   └── package.json       # Node dependencies
│
├── uploads/               # Uploaded files (auto-created)
├── research_index_db/     # Vector database (auto-created)
├── venv/                  # Python virtual environment
│
├── app.py                 # Flask API server
├── requirements.txt       # Python dependencies
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

---

## 🔒 Security Notes

### Environment Variables

This application uses environment variables for all sensitive configuration. Required variables:

```bash
# .env file (copy from .env.example)
NEO4J_PASS=your_neo4j_password_here  # Required - app will fail without this
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
FLASK_PORT=5000
```

The application will raise an error on startup if `NEO4J_PASS` is not set.

### For Production Deployment:

1. **Never commit `.env` files** - already in .gitignore
2. **Enable HTTPS** for API
3. **Add authentication** for multi-user access
4. **Rate limit** API endpoints
5. **Validate file uploads** strictly

---

## 🚢 Optional: Production Deployment

### Option 1: Single Server

```bash
# Build frontend
cd frontend
npm run build

# Serve with Flask
# Update app.py to serve static files from frontend/build
```

### Option 2: Separate Services

- **Frontend**: Deploy to Vercel/Netlify
- **Backend**: Deploy to Heroku/AWS/DigitalOcean
- **Neo4j**: Use Neo4j AuraDB (cloud)

---

## 📊 System Requirements

**Minimum:**
- 8GB RAM
- 10GB free disk space
- 2 CPU cores

**Recommended:**
- 16GB RAM
- 20GB free disk space
- 4+ CPU cores
- GPU (optional, for faster embeddings)

---

## 🎓 Features Overview

### ✅ What Works:

- ✅ Automatic file upload and processing
- ✅ Semantic search with confidence scores
- ✅ Knowledge graph queries (author relationships)
- ✅ Hybrid search combining both approaches
- ✅ Source citations with links
- ✅ Real-time query processing
- ✅ Beautiful web interface

### 🚧 Known Limitations:

- Single user at a time (database locks)
- English papers only (spaCy model)
- Requires manual Neo4j startup
- LLM answers can be slow (30-60s)

---

## 🆘 Need Help?

### Common Issues Checklist:

- [ ] Python virtual environment activated?
- [ ] All dependencies installed? (`pip install -r requirements.txt`)
- [ ] Neo4j Desktop running and database started?
- [ ] Ollama model installed? (`ollama list`)
- [ ] `.env` file configured with `NEO4J_PASS`?
- [ ] Both terminals running (Flask + React)?
- [ ] No old `research_index_db` folder locking database?

### Still Stuck?

1. Check terminal output for error messages
2. Verify all prerequisites are installed
3. Try restarting everything fresh
4. Check Neo4j Browser (http://localhost:7474) for database access

---

## 📚 Additional Resources

- **Ollama Documentation**: https://ollama.ai/docs
- **Neo4j Getting Started**: https://neo4j.com/docs/
- **ChromaDB Documentation**: https://docs.trychroma.com/
- **React Documentation**: https://react.dev/

---

## 🎉 You're All Set!

Your Hybrid RAG System should now be running at **http://localhost:3000**

Upload your research papers and start exploring! 🚀

---

## Quick Reference Commands

```bash
# Start everything (from project root)
source venv/bin/activate   # Activate Python env (Windows: venv\Scripts\activate)
python app.py              # Terminal 1 - Backend
cd frontend && npm start   # Terminal 2 - Frontend

# Stop everything
Ctrl+C (in both terminals)

# Reset database
rm -rf research_index_db                              # Mac/Linux
Remove-Item -Path research_index_db -Recurse -Force   # Windows PowerShell

# Update dependencies
pip install -r requirements.txt
cd frontend && npm install

# Check service status (adjust port if using 5001)
curl http://localhost:5000/api/health  # Backend
curl http://localhost:3000             # Frontend

# macOS: If port 5000 is blocked, update both .env files to use 5001:
# .env: FLASK_PORT=5001
# frontend/.env: REACT_APP_API_URL=http://localhost:5001
```

---

**Version:** 1.0  
**Last Updated:** January 2026  
**License:** MIT
