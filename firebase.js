import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Configuração do aplicativo Web do projeto The Door no Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyDdVzae6A7wuR4OR-q7wGdU1Hb4aG7E320",
  authDomain: "the-door-2f6ca.firebaseapp.com",
  projectId: "the-door-2f6ca",
  storageBucket: "the-door-2f6ca.firebasestorage.app",
  messagingSenderId: "310864202412",
  appId: "1:310864202412:web:c60db1582d678742526d09"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
