// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD8dSAOl1AJmKcMh5AHlRlp6OjZ_61NmMk",
  authDomain: "taskmaster-31e08.firebaseapp.com",
  projectId: "taskmaster-31e08",
  storageBucket: "taskmaster-31e08.firebasestorage.app",
  messagingSenderId: "360381471174",
  appId: "1:360381471174:web:cb0551794c3f4e5dea7ac7",
  measurementId: "G-F11E5V8LB4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ ADD THESE
export const auth = getAuth(app);
export const db = getFirestore(app);


const analytics = getAnalytics(app);

export default app;