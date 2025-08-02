// File 1: netlify/functions/generate-and-store-puzzle.js

// This is your "robot" function. It runs automatically every day at midnight.
// Its job is to call the Gemini API to get a new puzzle and then save it to your database.

// We need this library to sign our requests to the database.
const { sign } = require('jsonwebtoken');

// The main handler for the function.
exports.handler = async function(event, context) {
    // Load all the secret keys from Netlify's environment variables.
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    // The private key needs to have its newline characters restored.
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    // --- Step 1: Generate a new puzzle with the Gemini API ---
    const today = new Date();
    const puzzleId = Math.floor((today - new Date('2024-01-01T00:00:00Z')) / 86400000);
    const prompt = `Generate a "LinkLoom" daily puzzle...`; // Your full, detailed prompt goes here.

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = { /* ... your full Gemini payload ... */ };

    let puzzleData;
    try {
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });
        if (!geminiResponse.ok) throw new Error('Gemini API failed');
        const geminiResult = await geminiResponse.json();
        puzzleData = JSON.parse(geminiResult.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error("Error generating puzzle:", error);
        return { statusCode: 500, body: "Failed to generate puzzle from Gemini." };
    }

    // --- Step 2: Authenticate with the Firebase REST API ---
    const authUrl = 'https://oauth2.googleapis.com/token';
    const claims = {
        iss: FIREBASE_CLIENT_EMAIL,
        sub: FIREBASE_CLIENT_EMAIL,
        aud: authUrl,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // Token is valid for 1 hour
        scope: 'https://www.googleapis.com/auth/datastore'
    };
    const token = sign(claims, FIREBASE_PRIVATE_KEY, { algorithm: 'RS256' });

    let accessToken;
    try {
        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${token}`
        });
        const authData = await authResponse.json();
        accessToken = authData.access_token;
    } catch (error) {
        console.error("Error getting Firebase token:", error);
        return { statusCode: 500, body: "Failed to authenticate with Firebase." };
    }

    // --- Step 3: Save the new puzzle to the Firestore database ---
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/puzzles`;
    
    // We need to format the data in the way Firestore's REST API expects.
    const firestorePayload = {
        fields: {
            puzzleId: { integerValue: puzzleId },
            data: { stringValue: JSON.stringify(puzzleData) }
        }
    };

    try {
        await fetch(`${firestoreUrl}?documentId=${puzzleId}`, {
            method: 'PATCH', // Use PATCH to create or overwrite the document
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(firestorePayload)
        });
    } catch (error) {
        console.error("Error saving to Firestore:", error);
        return { statusCode: 500, body: "Failed to save puzzle to database." };
    }

    return {
        statusCode: 200,
        body: `Successfully generated and stored puzzle #${puzzleId}.`
    };
};
