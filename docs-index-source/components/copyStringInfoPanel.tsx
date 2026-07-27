import { useRouter } from 'next/router';
import React from 'react';
import styles from './infoPanel.module.css';

const CopyStringInfoPanel = ({ qsParamKey, defaultValue }: { qsParamKey: string, defaultValue: string}) => {
  const router = useRouter();
  const qs = router.query;
  const paramToCopy = qs[qsParamKey] ?? '';
  const [copyLabel, setCopyLabel] = React.useState<string>('Copy')

  const handleCopy = () => {
    navigator.clipboard.writeText(paramToCopy as string);
    setCopyLabel('Copied!')
  };

  return (
    <>
      {paramToCopy && (
        <div className={styles['copy-panel']}>
          <button
            onClick={handleCopy}
            className={styles['button--top-right']}
          >
            {copyLabel}
          </button>
          <pre className={styles['wrap-word']}>
            {paramToCopy ? paramToCopy : defaultValue}
          </pre>
        </div>
      )}
    </>
  );
};

export default function MyApp({ qsParamKey, defaultValue }: { qsParamKey: string, defaultValue: string}) {
  return <CopyStringInfoPanel qsParamKey={qsParamKey} defaultValue={defaultValue}  />
}
