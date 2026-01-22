import { Loader, Alert } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { getAppName } from "@/lib/config.ts";
import { getComplianceAppUrl } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import { useState, useEffect } from "react";
import classes from "./compliance-app.module.css";

export default function ComplianceApp() {
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const [iframeError, setIframeError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const complianceAppUrl = getComplianceAppUrl();

  useEffect(() => {
    // Set a timeout to detect if iframe fails to load
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 10000); // 10 seconds timeout

    return () => clearTimeout(timeout);
  }, []);

  const handleIframeLoad = () => {
    setIsLoading(false);
    setIframeError(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setIframeError(true);
  };

  return (
    <>
      <Helmet>
        <title>
          {space?.name || "Compliance App"} - Compliance - {getAppName()}
        </title>
      </Helmet>
      <div className={classes.wrapper}>
        {isLoading && (
          <div className={classes.loaderContainer}>
            <Loader size="lg" />
          </div>
        )}
        
        {iframeError && (
          <Alert color="red" title="Error loading Compliance App" className={classes.errorAlert}>
            Unable to connect to the Compliance App. Please ensure it is running
            at {complianceAppUrl}
          </Alert>
        )}

        <iframe
          src={complianceAppUrl}
          className={classes.complianceIframe}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title="Compliance App"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          allow="encrypted-media"
          style={{ display: iframeError ? "none" : "block" }}
        />
      </div>
    </>
  );
}

