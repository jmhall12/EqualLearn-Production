// Point this to the deployed EqualLearn Lumi Worker grading route.
// Example: https://your-worker.your-subdomain.workers.dev/grade-assist
// Do not put a Cloudflare API token or service-account key in this file.
export const TEACHER_GRADING_AI_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/grade-assist";

export function isTeacherGradingAIConfigured() {
  return /^https:\/\/.+\/grade-assist$/i.test(TEACHER_GRADING_AI_URL) && !TEACHER_GRADING_AI_URL.includes("YOUR-WORKER-NAME");
}
