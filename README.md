# S3 Drop

A Raycast extension that uploads files from your clipboard to AWS S3 and copies a 24-hour presigned URL to your clipboard.

## Building & Installing

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Raycast](https://raycast.com/) installed on your Mac

### Development Mode

1. Clone this repository
2. Navigate to the extension directory:
   ```bash
   cd s3-drop
   ```
3. Install dependencies and start development mode:
   ```bash
   npm install && npm run dev
   ```
4. Raycast will open automatically and the extension will appear in a **Development** section at the top of the root search
5. Changes are automatically reloaded when you save files

### Production Build

To validate the extension for distribution:

```bash
npm run build
```

### Other Commands

```bash
npm run lint       # Run ESLint
npm run fix-lint   # Auto-fix lint issues
```

## AWS Setup

### 1. Create an S3 Bucket

1. Go to the [AWS S3 Console](https://s3.console.aws.amazon.com/)
2. Click **Create bucket**
3. Enter a bucket name (e.g., `my-clipboard-uploads`)
4. Select your preferred region (note this for later)
5. Keep **Block all public access** enabled (presigned URLs don't require public access)
6. Click **Create bucket**

### 2. Create an IAM User

1. Go to the [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Navigate to **Users** > **Create user**
3. Enter a username (e.g., `raycast-uploader`)
4. Click **Next**
5. Select **Attach policies directly**
6. Click **Create policy** and use the JSON editor to add:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

Replace `YOUR_BUCKET_NAME` with your actual bucket name.

7. Name the policy (e.g., `RaycastS3UploaderPolicy`) and create it
8. Go back to the user creation, refresh the policy list, and attach your new policy
9. Complete user creation
10. Go to the user > **Security credentials** > **Create access key**
11. Select **Application running outside AWS**
12. Copy the **Access Key ID** and **Secret Access Key** (you won't see the secret again)

### 3. (Optional) Auto-Delete Old Files

You can automatically delete old files to save storage costs.

1. Go to your bucket in the [S3 Console](https://s3.console.aws.amazon.com/)
2. Click the **Management** tab
3. Click **Create lifecycle rule**
4. Enter a rule name (e.g., `delete-after-1-day`)
5. Apply to all objects in the bucket
6. Under **Lifecycle rule actions**, check **Expire current versions of objects**
7. Set **Days after object creation** to `1` (or longer if you prefer)
8. Click **Create rule**

Objects will be automatically deleted after the specified number of days.

## Extension Configuration

When you first run the extension, Raycast will prompt you to configure:

| Setting               | Description                | Example                             |
| --------------------- | -------------------------- | ----------------------------------- |
| AWS Access Key ID     | Your IAM user's access key | `AKIAIOSFODNN7EXAMPLE`              |
| AWS Secret Access Key | Your IAM user's secret key | (stored securely in macOS Keychain) |
| S3 Bucket Name        | The bucket you created     | `my-clipboard-uploads`              |
| AWS Region            | The region of your bucket  | `us-east-1`                         |

## Usage

1. Copy a file to your clipboard (select a file in Finder and press `Cmd+C`)
2. Open Raycast and run **Drop to S3**
3. The file uploads and a presigned URL (valid for 24 hours) is copied to your clipboard
4. Paste the URL anywhere to share

## How It Works

- Files remain private in your S3 bucket
- Presigned URLs allow temporary access without making the bucket public
- URLs automatically expire after 24 hours
