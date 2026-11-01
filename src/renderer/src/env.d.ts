import type { FeatureReleaseApi } from "@shared/api";

declare global {
  interface Window {
    featureRelease?: FeatureReleaseApi;
  }
}