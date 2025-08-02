// File 1: src/generate-and-store-puzzle.js
// This version uses modern 'import' syntax.

import { sign } from 'jsonwebtoken';

export const handler = async function(event, context) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // --- Step 1: Generate a new puzzle with the Gemini API ---
    const today = new Date();
    const puzzleId = Math.floor((today - new Date('2024-01-01T00:00:00Z')) / 86400000);
    
    const prompt = `Generate a "LinkLoom" daily puzzle...`; // Prompt omitted for brevity
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = { /* ... payload omitted for brevity ... */ };

    let puzzleData;
    try {
        const geminiResponse = await fetch(geminiUrl, { /* ... fetch options ... */ });
        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Gemini API Error:", JSON.stringify(errorBody, null, 2));
            throw new Error(`Gemini API failed with status: ${geminiResponse.status}`);
        }
        const geminiResult = await geminiResponse.json();
        puzzleData = JSON.parse(geminiResult.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error("Error in Step 1 (Gemini):", error);
        return { statusCode: 500, body: "Failed to generate puzzle from Gemini." };
    }

    // --- Step 2: Authenticate with the Firebase REST API ---
    const authUrl = '[https://oauth2.googleapis.com/token](https://oauth2.googleapis.com/token)';
    const claims = {
        iss: FIREBASE_CLIENT_EMAIL,
        sub: FIREBASE_CLIENT_EMAIL,
        aud: authUrl,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: '[https://www.googleapis.com/auth/datastore](https://www.googleapis.com/auth/datastore)'
    };
    
    let accessToken;
    try {
        if (!FIREBASE_PRIVATE_KEY) throw new Error("FIREBASE_PRIVATE_KEY is not set.");
        const token = sign(claims, FIREBASE_PRIVATE_KEY, { algorithm: 'RS256' });
        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
        });
        if (!authResponse.ok) {
            const errorBody = await authResponse.json();
            console.error("Firebase Auth Error:", JSON.stringify(errorBody, null, 2));
            throw new Error(`Firebase Auth failed with status: ${authResponse.status}`);
        }
        const authData = await authResponse.json();
        accessToken = authData.access_token;
    } catch (error) {
        console.error("Error in Step 2 (Firebase Auth):", error);
        return { statusCode: 500, body: "Failed to authenticate with Firebase." };
    }

    // --- Step 3: Save the new puzzle to the Firestore database ---
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/puzzles/${puzzleId}`;
    const firestorePayload = {
        fields: {
            puzzleId: { integerValue: puzzleId },
            data: { stringValue: JSON.stringify(puzzleData) }
        }
    };

    try {
        const firestoreResponse = await fetch(firestoreUrl, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(firestorePayload)
        });
        if (!firestoreResponse.ok) {
            const errorBody = await firestoreResponse.json();
            console.error("Firestore Save Error:", JSON.stringify(errorBody, null, 2));
            throw new Error(`Firestore save failed with status: ${firestoreResponse.status}`);
        }
    } catch (error) {
        console.error("Error in Step 3 (Firestore Save):", error);
        return { statusCode: 500, body: "Failed to save puzzle to database." };
    }

    return {
        statusCode: 200,
        body: `Successfully generated and stored puzzle #${puzzleId}.`
    };
};
