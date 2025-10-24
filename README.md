# LSE Honours Study System

A comprehensive study management system for LSE Economics students with module organization, PDF annotation tools, and AI-powered study assistance.

## Features

- **Module Organization**: Create custom modules for each subject and upload lecture slides
- **Deep Focus Mode**: Annotate PDFs with highlights and pen tools that persist across sessions
- **AI Study Assistant**: RAG-powered chatbot that answers questions about your lecture materials
- **Cloud Storage**: All files stored securely in S3 with automatic backups

## Tech Stack

- **Frontend**: React 19 + Vite + Tailwind CSS 4
- **Backend**: Express + tRPC
- **Database**: MySQL (TiDB)
- **AI**: OpenAI GPT-4o-mini with RAG
- **Storage**: AWS S3
- **PDF**: PDF.js + React-PDF

## Deployment to Vercel

### Prerequisites

1. A Vercel account
2. OpenAI API key from https://platform.openai.com/api-keys
3. Database connection string (MySQL/TiDB)

### Steps

1. **Import the repository to Vercel**:
   - Go to https://vercel.com/new
   - Import the GitHub repository: `xanderys/lse-honours-system`

2. **Configure Environment Variables**:
   Add the following environment variables in Vercel project settings:

   ```
   DATABASE_URL=your_mysql_connection_string
   JWT_SECRET=your_random_secret_key
   OPENAI_API_KEY=your_openai_api_key
   VITE_APP_ID=lse-honours-system
   VITE_APP_TITLE=LSE Honours Study System
   VITE_APP_LOGO=https://your-logo-url.com/logo.png
   OAUTH_SERVER_URL=https://api.manus.im
   OWNER_OPEN_ID=your_owner_id
   OWNER_NAME=Your Name
   BUILT_IN_FORGE_API_URL=https://api.manus.im
   BUILT_IN_FORGE_API_KEY=your_forge_api_key
   ```

3. **Build Settings**:
   - Framework Preset: Other
   - Build Command: `pnpm install && pnpm build`
   - Output Directory: `client/dist`
   - Install Command: `pnpm install`

4. **Deploy**:
   - Click "Deploy"
   - Wait for the build to complete
   - Your app will be live at `https://your-project.vercel.app`

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/xanderys/lse-honours-system.git
   cd lse-honours-system
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   Create a `.env` file with the required variables (see Deployment section)

4. Push database schema:
   ```bash
   pnpm db:push
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

6. Open http://localhost:3000

## Usage

1. **Create a Module**: Click "New Module" and give it a name and color
2. **Upload PDFs**: Navigate to a module and upload your lecture slides
3. **Deep Focus**: Click on a PDF to enter Deep Focus mode
4. **Annotate**: Use the highlight and pen tools to mark up your PDFs
5. **Ask Questions**: Use the Questions section to note things you want to follow up on
6. **Chat with AI**: Ask the AI assistant questions about the material in your PDF

## License

MIT

