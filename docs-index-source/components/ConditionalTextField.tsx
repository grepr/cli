import React from 'react';
import { useRouter } from 'next/router'
import styles from './infoPanel.module.css'

/**
 * Will display the textValue if:
 * paramPresent is FALSE and qsParamKey is EMPTY
 * OR
 * paramPresent is TRUE and qsParamKey is PRESENT
 * @constructor
 */
const ConditionalTextField = ({ paramPresent, qsParamKey, textValue }: { paramPresent: string, qsParamKey: string, textValue: string }) => {
  const router = useRouter();
  const qs = router.query;
  const paramValue = qs[qsParamKey] ?? '';
  return (
    <>
      {(paramValue.length > 0 == (paramPresent == "true")) && (
        <div className={styles['copy-panel']}>
          <pre className={styles['wrap-word']}>
            {textValue}
          </pre>
        </div>
      )}
    </>
  )
}

export default ConditionalTextField;
