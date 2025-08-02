// File 2: netlify/functions/get-daily-puzzle.js

// This function is called by the game when a player opens it.
// It securely fetches today's puzzle from the database and sends it to the player.

const { sign } = require('jsonwebtoken');

exports.handler = async function(event, context) {
    // Load secrets
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    // --- Step 1: Authenticate with Firebase (same as above) ---
    const authUrl = 'https://oauth2.googleapis.com/token';
    const claims = { /* ... same claims as above ... */ };
    const token = sign(claims, FIREBASE_PRIVATE_KEY, { algorithm: 'RS256' });
    
    let accessToken;
    try {
        const authResponse = await fetch(authUrl, { /* ... same auth request ... */ });
        const authData = await authResponse.json();
        accessToken = authData.access_token;
    } catch (error) {
        return { statusCode: 500, body: "Auth error." };
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
        if (!puzzleResponse.ok) throw new Error('Puzzle not found');
        
        const puzzleDoc = await puzzleResponse.json();
        // The data is stored as a string, so we just return that string.
        const puzzleJsonString = puzzleDoc.fields.data.stringValue;

        return {
            statusCode: 200,
            body: puzzleJsonString
        };
    } catch (error) {
        console.error("Error fetching puzzle:", error);
        return { statusCode: 404, body: "Could not find today's puzzle." };
    }
};