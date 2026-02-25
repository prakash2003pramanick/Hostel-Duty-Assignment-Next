   # Hostel Duty Assignment - Next.js

A combined Next.js application that merges the Hostel Duty Frontend (React) and Hostel Duty Assignment (Express backend) into a single full-stack application.

## Features

- **Home**: Generate duty assignments by date range and hostel type (Boys/Girls), download as Excel
- **Upload Faculty Data**: Add/update faculty from Excel files
- **Report**: Search faculty duty history by employee code
- **Settings**: Configure boys/girls hostel group counts

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   - Copy `.env.local.example` to `.env.local`
   - Set `MONGO_URI` to your MongoDB connection string

3. **Run development server**
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## API Routes

All API routes are internal (same origin):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/duty/assign_duty` | POST | Assign duties for date range |
| `/api/duty/export_excel` | POST | Export assignments to Excel |
| `/api/duty/report/[empCode]` | GET | Get faculty duty report |
| `/api/settings` | GET/PUT | Get or update settings |
| `/api/hostels` | GET | List hostels (optional ?type=BOYS|GIRLS) |
| `/api/groups` | GET | List groups (optional ?type=BOYS|GIRLS) |
| `/api/hostel/add-or-update-manually` | POST | Add or update hostel |
| `/api/group/add-or-update-manually` | POST | Add or update group |
| `/api/upload/add_employee` | POST | Upload faculty Excel |

## Project Structure

```
src/
├── app/
│   ├── api/           # API route handlers
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/         # React components
│   ├── HomePage.tsx
│   ├── UploadPage.tsx
│   ├── ReportPage.tsx
│   └── SettingPage.tsx
└── lib/
    ├── db.ts           # MongoDB connection
    ├── models/         # Mongoose models
    └── utils/          # Shared utilities
```

## Build

```bash
npm run build
npm start
```

## Vercel Deployment

If you get **NOT_FOUND** on Vercel:

1. **Root Directory**: If your repo root is `HDA` (with subfolders like `hostel-duty-nextjs`), set **Root Directory** to `hostel-duty-nextjs` in Vercel Project Settings → General.

2. **Environment Variables**: Add `MONGO_URI` in Vercel → Project Settings → Environment Variables (for Production, Preview, Development).

3. **MongoDB Atlas**: Allow Vercel IPs or use `0.0.0.0/0` in Network Access (for development; restrict in production).

4. **Build**: Ensure the build succeeds. Check Deployment logs for errors. Run `npm run build` locally first.
