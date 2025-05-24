# 📧 Email Archiver for G-Suite

A backend system that connects to a **Google Workspace (G-Suite) Gmail inbox**, automatically archives all incoming emails into a **PostgreSQL database**, parses their content and metadata, and **uploads attachments to Google Drive**. It ensures email integrity, threading, and auditability.

---

## 🚀 Features

- **OAuth 2.0 Authentication** — Secure and passwordless Gmail & Drive integration.
- **Incremental Email Syncing** — Efficient email fetching using Gmail History API.
- **Comprehensive Metadata Capture** — Stores sender, recipients, subject, timestamps, message headers.
- **Attachment Management** — Uploads attachments to Google Drive with links stored in DB.
- **Thread Preservation** — Maintains email threads via `In-Reply-To` and `References` headers.
- **De-duplication** — Avoids storing duplicate emails using Gmail ID and Message-ID.
- **Automated Cron Jobs** — Periodically syncs emails (defaults to every 5 minutes).
- **Error Resilience** — Graceful handling of API failures and partial syncs.

---

## 🧰 Tech Stack

| Layer     | Tech                    |
| --------- | ----------------------- |
| Backend   | Node.js, Express.js     |
| Language  | TypeScript              |
| Database  | PostgreSQL + Prisma ORM |
| Auth      | OAuth 2.0 (Google)      |
| APIs      | Gmail API, Drive API    |
| Scheduler | node-cron               |

---

## ⚙️ Setup Instructions

### ✅ Prerequisites

- Node.js v18+
- npm or yarn
- PostgreSQL instance
- GCP Project with Gmail & Drive APIs enabled
- OAuth 2.0 credentials from GCP

### 📦 Installation

```bash
git clone https://github.com/maheshchichkoti/email-archiver.git
cd email-archiver
npm install
```

### 🗃️ Database Setup

1. Start your PostgreSQL server.
2. Create a database (e.g. `email_archiver_db`).
3. Configure `.env`:

```env
# .env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/email_archiver_db"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://localhost:3000/auth/google/callback"
ENCRYPTION_KEY="..."  # 64 hex chars
ENCRYPTION_IV="..."   # 32 hex chars
PORT=3000
CRON_SCHEDULE="*/5 * * * *"
GOOGLE_DRIVE_FOLDER_ID="..." # optional
```

### 🔧 Apply Migrations

```bash
npx prisma migrate dev --name init
```

---

## 🧪 Running the App

### 1. Start Dev Server

```bash
npm run dev
```

### 2. Authorize Gmail (First-Time Setup)

Visit [http://localhost:3000](http://localhost:3000)

- Click **Login With Google**
- Grant Gmail & Drive permissions
- Tokens are securely stored in the DB

### 3. Automatic Syncing

Runs based on `CRON_SCHEDULE` (default: every 5 mins)

- Uses Gmail History API to fetch only new emails
- Stores email content, metadata, and attachments

### 4. Manual Sync (for testing)

Visit [http://localhost:3000/sync-now](http://localhost:3000/sync-now)

---

## ✅ Assessment Criteria Mapping

| Criteria                               | Implementation                                                    |
| -------------------------------------- | ----------------------------------------------------------------- |
| **OAuth without password**             | OAuth 2.0 with `googleapis` lib, encrypted refresh token storage  |
| **Emails archived within 5 minutes**   | Cron job runs `runEmailSync` every 5 mins using Gmail History API |
| **Attachments stored in Google Drive** | Uploaded via Drive API, linked to emails in DB                    |
| **Metadata extraction**                | `emailParser.ts` parses sender, recipients, subject, headers      |
| **Thread preservation**                | Stores `In-Reply-To` and `References`                             |
| **Correct handling of CC/BCC**         | Full string capture of all recipient fields                       |
| **Duplicate prevention**               | Unique constraints on Gmail ID and Message-ID with error catch    |

---

## 🔍 How to Verify

- **Console Logs**: Monitor logs for sync activity, duplicates, and errors
- **PostgreSQL**:

```sql
SELECT * FROM "Email" ORDER BY "createdAt" DESC;
SELECT * FROM "Attachment" ORDER BY "createdAt" DESC;
```

- **Google Drive**: Check uploaded files in Drive (and folder if specified)

---

## 📁 Project Structure

```bash
/src
├── auth/           # OAuth logic
├── controllers/    # Express route handlers
├── jobs/           # Cron jobs & sync logic
├── lib/            # Prisma client init
├── models/         # DB layer (email, attachment, token models)
├── services/       # Gmail & Drive API interactions
├── utils/          # Parsers, encryption helpers
├── index.ts        # App entry point
/prisma
├── schema.prisma   # Prisma schema
├── migrations/     # DB migration files
.env
.env.example
```

---

## 🧠 Notes

- Ensure OAuth consent screen is configured on GCP
- Redirect URI must match GCP settings exactly
- Gmail History API provides efficient delta sync — no full fetch
- Attachments are downloaded and streamed to Drive; links are stored

---

## 👥 Author & License

Created by \maheshChichkoti.<br>
MIT License.

---

Happy Archiving 📥
