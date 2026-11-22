# 📈 MarketPulse

### Full-Stack Cryptocurrency & Stock Market Tracking Platform

MarketPulse is a full-stack financial market tracking application built with **React, TypeScript, Node.js, Express, and PostgreSQL**. It provides an interactive dashboard for exploring cryptocurrency and stock market data, viewing historical price trends, and organizing favorite assets into personalized watchlists.

The project focuses on responsive design, secure authentication, reliable market-data handling, and scalable backend architecture.

## ✨ Features

### 📊 Market Dashboard

- Interactive cryptocurrency and stock market dashboard
- Asset search, filtering, and sorting
- Price cards with 24-hour changes
- Market-data source and freshness indicators
- Responsive interface with dark-themed styling

### 📉 Historical Price Charts

- Interactive price history visualizations
- Multiple supported time ranges
- Historical data retrieved through backend APIs
- Clear loading, stale, and unavailable states

### ⭐ Personalized Watchlists

- Create, rename, and delete watchlists
- Add and remove cryptocurrency and stock assets
- View saved assets with their latest available prices
- PostgreSQL-backed persistence
- User-specific watchlist access

### 🔐 Authentication & Security

- User registration and login
- Secure session management
- Protected application routes
- CSRF protection
- Request validation and rate limiting
- Ownership checks for private resources

### 🌐 Market Data Integration

- CoinGecko integration for cryptocurrency market data
- Configurable demo and live crypto modes
- Simulated stock prices for development
- Server-side caching and provider quota management
- Explicit real, simulated, stale, and unavailable data labels

**Note:** Live cryptocurrency data requires provider configuration. The application may operate in demo mode, and stock prices are currently simulated.

## 🛠️ Tech Stack

| Category        | Technologies                         |
| --------------- | ------------------------------------ |
| Frontend        | React, TypeScript, Vite              |
| Styling         | Tailwind CSS                         |
| Backend         | Node.js, Express, TypeScript         |
| Database        | PostgreSQL                           |
| ORM             | Prisma                               |
| Market Data     | CoinGecko API, Demo Provider         |
| Testing         | Automated unit and integration tests |
| DevOps          | Docker Compose, GitHub Actions       |
| Version Control | Git, GitHub                          |

## 🏗️ Architecture

```text
MarketPulse
│
├── Frontend (React + TypeScript)
│   ├── Market Dashboard
│   ├── Asset Details
│   ├── Historical Charts
│   ├── Watchlists
│   └── Authentication
│
├── Backend (Node.js + Express)
│   ├── REST API
│   ├── Authentication & Sessions
│   ├── Market Data Providers
│   ├── Cache & Quota Management
│   └── Watchlist Services
│
├── Database (PostgreSQL + Prisma)
│   ├── Users & Sessions
│   ├── Assets
│   ├── Market Data Cache
│   └── Watchlists
│
└── External Market Data APIs
    └── CoinGecko
```

## 🚀 Getting Started

### Prerequisites

- Node.js
- npm
- Docker and Docker Compose
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/akanksha15sharma/Market-pulse.git
cd Market-pulse
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure the Environment

Configure the backend environment variables using the project's example configuration files.

Market-data provider configuration is documented in `docs/live-crypto.md`.

Keep API keys, database credentials, and other secrets outside version control.

### 4. Start Required Services

```bash
docker compose up -d
```

### 5. Set Up the Database

Apply the project's Prisma migrations and seed the supported market assets using the repository's database setup scripts.

### 6. Start the Application

```bash
npm run dev
```

Open the frontend at:

**http://127.0.0.1:5173**

Backend API:

**http://127.0.0.1:3001**

## 🧪 Testing

Run the available project checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Database integration tests require a configured test PostgreSQL database.

## 🔮 Future Improvements

- Real stock market data integration
- Configurable price alerts and notifications
- Portfolio tracking and performance analytics
- Additional chart indicators
- Deployment and production monitoring

## 👩‍💻 Author

**Akanksha Sharma**

GitHub: [@akanksha15sharma](https://github.com/akanksha15sharma)

## 📄 Disclaimer

MarketPulse is an educational and portfolio project. Market data may be delayed, cached, unavailable, or simulated depending on provider configuration.

The application does not provide investment advice or execute financial transactions.

## Phase 7 — price alerts

Signed-in users can manage private USD price targets and target-reached history at
`/alerts`. This phase follows the explicit request to build alerts before portfolios.
Only fresh, post-arm real CoinPaprika quotes can trigger an alert. Stock targets
remain saved but blocked while stocks use simulated data. Apply the additive event
provenance migration before running the feature. See [setup and semantics](docs/alerts.md)
and [verification results](PHASE7-VERIFICATION.md). Work stops before Phase 8.
