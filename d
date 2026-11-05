warning: in the working copy of 'mobile/src/lib/firebase.js', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/mobile/src/lib/firebase.js b/mobile/src/lib/firebase.js[m
[1mindex 80ecfd6..4bc1d64 100644[m
[1m--- a/mobile/src/lib/firebase.js[m
[1m+++ b/mobile/src/lib/firebase.js[m
[36m@@ -4,12 +4,12 @@[m [mimport { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/aut[m
 import { getFirestore } from 'firebase/firestore';[m
 [m
 export const firebaseConfig = {[m
[31m-  apiKey: 'AIzaSyDLpkH-uQlPy3idTh_rdZgp_SP-rMF298U',[m
[31m-  authDomain: 'equallearn-test.firebaseapp.com',[m
[31m-  projectId: 'equallearn-test',[m
[31m-  storageBucket: 'equallearn-test.firebasestorage.app',[m
[31m-  messagingSenderId: '708796542875',[m
[31m-  appId: '1:708796542875:web:1a415e6a8e43e7806ebb3e',[m
[32m+[m[32m  apiKey: 'AIzaSyDs5tws2jGZAS2q-9op_lIgAdyqfIXW4Uw',[m
[32m+[m[32m  authDomain: 'equallearn-eb389.firebaseapp.com',[m
[32m+[m[32m  projectId: 'equallearn-eb389',[m
[32m+[m[32m  storageBucket: 'equallearn-eb389.firebasestorage.app',[m
[32m+[m[32m  messagingSenderId: '897069961442',[m
[32m+[m[32m  appId: '1:897069961442:web:98dfabd5efefa1e79a4ebb',[m
 };[m
 [m
 export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);[m
