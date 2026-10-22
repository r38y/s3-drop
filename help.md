# Connect Your S3 Bucket

S3 Drop needs an AWS S3 bucket and an IAM access key. Uploaded files stay private; anyone with the generated link can download the file for 24 hours.

## 1. Choose a Bucket

Create a dedicated S3 Drop bucket in the [S3 console](https://s3.console.aws.amazon.com/) or use an existing bucket reserved for these uploads. Keep **Block all public access** enabled. Copy its exact name and AWS region into **S3 Bucket Name** and **AWS Region**.

## 2. Allow Uploads and Downloads

Give your IAM user this policy, replacing `YOUR_BUCKET_NAME` with the bucket name:

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

In the [IAM console](https://console.aws.amazon.com/iam/), open the user's **Security credentials** and create an access key for an application running outside AWS. Enter it in **AWS Access Key ID** and **AWS Secret Access Key**. Keep the secret key private.

## 3. Share a File

Copy one file in Finder, then run **Drop to S3**. Paste the link from your clipboard to share it.

The link expires after 24 hours, but the file stays in S3. Revoking credentials, changing permissions, or deleting the file can invalidate a link earlier. Set a lifecycle rule on your dedicated bucket if you want AWS to expire old uploads automatically. Expiration is asynchronous; versioned buckets also need a rule to delete noncurrent versions. Never apply a bucket-wide expiration rule to unrelated files. See the [README](https://github.com/r38y/s3-drop#aws-setup) for detailed setup instructions.
