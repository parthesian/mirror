# Deployment Guide - Cloudflare Pages with CI/CD

This guide walks you through deploying your photo gallery application to Cloudflare Pages using GitHub Actions for CI/CD.

## Prerequisites

- GitHub repository with your project code
- Cloudflare account (free tier is sufficient)

## Step-by-Step Deployment Process

### 1. Create Cloudflare Account

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Sign up for a free Cloudflare account
3. Verify your email address

### 2. Create Cloudflare Pages Project

1. In your Cloudflare dashboard, go to **Pages** in the left sidebar
2. Click **Create a project**
3. Choose **Connect to Git**
4. Connect your GitHub account and select your repository
5. Configure build settings:
   - **Project name**: Choose a name (e.g., `photo-gallery`)
   - **Production branch**: `main`
   - **Build command**: Leave empty (static site)
   - **Build output directory**: Leave empty (root directory)
6. Click **Save and Deploy**

### 3. Get Cloudflare Credentials

#### Get Account ID:
1. In Cloudflare dashboard, go to the right sidebar
2. Copy your **Account ID**

#### Get API Token:
1. Go to [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use **Custom token** template
4. Configure permissions:
   - **Account**: `Cloudflare Pages:Edit`
   - **Zone Resources**: `Include - All zones`
5. Click **Continue to summary** → **Create Token**
6. Copy the token (you won't see it again!)

### 4. Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add these secrets:

   - **Name**: `CLOUDFLARE_API_TOKEN`
     **Value**: Your API token from step 3

   - **Name**: `CLOUDFLARE_ACCOUNT_ID`
     **Value**: Your Account ID from step 3

   - **Name**: `CLOUDFLARE_PROJECT_NAME`
     **Value**: Your project name from step 2 (e.g., `photo-gallery`)

   - **Name**: `API_BASE_URL`
     **Value**: `https://n6ntegdbxi.execute-api.us-west-2.amazonaws.com/prod`

   - **Name**: `UPLOAD_PASSWORD_HASH`
     **Value**: `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`

### 5. Deploy

1. Push your changes to the `main` branch:
   ```bash
   git add .
   git commit -m "Add Cloudflare Pages deployment"
   git push origin main
   ```

2. GitHub Actions will automatically:
   - Process your config template
   - Inject environment variables
   - Deploy to Cloudflare Pages

3. Check the **Actions** tab in your GitHub repository to monitor deployment progress

### 6. Access Your Site

Once deployment completes:
1. Go to your Cloudflare Pages dashboard
2. Click on your project
3. Your site URL will be shown (e.g., `https://photo-gallery.pages.dev`)

## Security Notes

- Your sensitive configuration (`API_BASE_URL` and `UPLOAD_PASSWORD_HASH`) are stored as GitHub secrets
- The `config.js` file is excluded from your repository via `.gitignore`
- Environment variables are injected during the build process

## Troubleshooting

### Deployment Fails
- Check GitHub Actions logs in the **Actions** tab
- Verify all secrets are correctly set
- Ensure your Cloudflare API token has the right permissions

### Site Loads but API Calls Fail
- Verify `API_BASE_URL` secret is correct
- Check browser console for CORS errors
- Ensure your AWS API allows requests from your Cloudflare domain

### Upload Functionality Not Working
- Verify `UPLOAD_PASSWORD_HASH` secret matches your expected password hash
- Check network tab for failed upload requests

## Custom Domain (Optional)

To use a custom domain:
1. In Cloudflare Pages, go to your project
2. Click **Custom domains** tab
3. Click **Set up a custom domain**
4. Follow the DNS configuration instructions
