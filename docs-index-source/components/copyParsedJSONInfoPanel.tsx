import { useRouter } from 'next/router';
import React from 'react';
import styles from './infoPanel.module.css';

const CopyParsedJSONInfoPanel = () => {
  const router = useRouter();
  const { resourcePolicy } = router.query;
  const defaultJSON = `{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::992382778380:role/customer-role-{YOUR_ORG_NAME}"
            },
            "Action": [
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": "arn:aws:s3:::{YOUR_S3_BUCKET_NAME}"
        },
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::992382778380:role/customer-role-{YOUR_ORG_NAME}"
            },
            "Action": [
                "s3:DeleteObjectTagging",
                "s3:PutObject",
                "s3:GetObject",
                "s3:PutObjectTagging",
                "s3:DeleteObject"
            ],
            "Resource": "arn:aws:s3:::{YOUR_S3_BUCKET_NAME}/*"
        }
    ]
}`
  const [copyLabel, setCopyLabel] = React.useState<string>('Copy')

  const parseJsonString = (str) => {
    try {
      const unescapedStr = str.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      return JSON.parse(unescapedStr);
    } catch (e) {
      return JSON.parse(defaultJSON);
    }
  };

  const parsedJson = parseJsonString(resourcePolicy as string);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(parsedJson, null, 2));
    setCopyLabel('Copied!')
  };


  return (
    <div className={styles['copy-panel']}>
      <button 
        onClick={handleCopy}
        className={styles['button--top-right']}
      >
        {copyLabel}
      </button>
      <pre className={styles['wrap-word']}>
        {parsedJson ? JSON.stringify(parsedJson, null, 2) : 'Invalid JSON'}
      </pre>
    </div>
  );
};

export default function MyApp() {
  return <CopyParsedJSONInfoPanel  />
}
