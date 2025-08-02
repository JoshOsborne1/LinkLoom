// File 2: src/get-daily-puzzle.js
// This version also has enhanced error logging.

const { sign } = require('jsonwebtoken');

exports.handler = async function(event, context) {
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // --- Step 1: Authenticate with Firebase ---
    const authUrl = 'https://oauth2.googleapis.com/token';
    const claims = {
        iss: FIREBASE_CLIENT_EMAIL,
        sub: FIREBASE_CLIENT_EMAIL,
        aud: authUrl,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        scope: 'https://www.googleapis.com/auth/datastore'
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
        console.error("Error in Auth step:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Auth error." }) };
    }

    // --- Step 2: Fetch today's puzzle from Firestore ---
    const today = new Date();
    const puzzleId = Math.floor((today - new Date('2024-01-01T00:00:00Z')) / 86400000);
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/puzzles/${puzzleId}`;

    try {
        const puzzleResponse = await fetch(firestoreUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!puzzleResponse.ok) {
            const errorBody = await puzzleResponse.json();
            console.error("Firestore Fetch Error:", JSON.stringify(errorBody, null, 2));
            throw new Error(`Puzzle not found with status: ${puzzleResponse.status}`);
        }
        
        const puzzleDoc = await puzzleResponse.json();
        const puzzleJsonString = puzzleDoc.fields.data.stringValue;

        return {
            statusCode: 200,
            body: puzzleJsonString // Return the raw JSON string
        };
    } catch (error) {
        console.error("Error fetching puzzle:", error);
        return { statusCode: 404, body: JSON.stringify({ error: "Could not find today's puzzle." }) };
    }
};
