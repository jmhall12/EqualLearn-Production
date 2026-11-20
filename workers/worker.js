name = "equallearn-lumi"
main = "worker.js"
compatibility_date = "2026-11-20"
workers_dev = true

[vars]
FIREBASE_PROJECT_ID = "equallearn-eb389"
FIREBASE_WEB_API_KEY = "AIzaSyDs5tws2jGZAS2q-9op_lIgAdyqfIXW4Uw"
WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash"
# Replace the final entry with the exact deployed EqualLearn origin.
ALLOWED_ORIGINS = "http://127.0.0.1:5500,http://localhost:5500,https://equallearn.pages.dev"
ADMIN_CONTACT_NAME = "EqualLearn Support Team"

[ai]
binding = "AI"
