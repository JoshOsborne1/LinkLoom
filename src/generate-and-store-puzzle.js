// File 1: src/generate-and-store-puzzle.js
// This version has the corrected Firestore URL.

const { sign } = require('jsonwebtoken');

exports.handler = async function(event, context) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // --- Step 1: Generate a new puzzle with the Gemini API ---
    const today = new Date();
    const puzzleId = Math.floor((today - new Date('2024-01-01T00:00:00Z')) / 86400000);
    
    const prompt = `Generate a "LinkLoom" daily puzzle. The core concept is that three different answers are all examples of a single category, and that category is the final "link". The final 'link' MUST be a single word.

**CRITICAL RULE:** The text of the questions ('t') MUST NOT contain the final 'link' word or obvious synonyms for it. The goal is for the player to discover the link from the *answers*, not the questions themselves. Be creative with the topics, drawing from science, history, pop culture, geography, and more.

**Gold-Standard Example 1 (Indirect Knowledge):**
- Q1: Which of the Beatles had the middle name Winston? A: John Lennon
- Q2: Marilyn Monroe once dated which US President? A: JFK
- Q3: Who was this famous quote about: 'Maradona was good, Pele was better, George was best'? A: George Best
- Link: Airports (John Lennon Airport, JFK Airport, George Best Airport are all real places).

**Gold-Standard Example 2 (UK-centric Consumer Goods):**
- Q1: Emperor and King are types of which flightless bird? A: Penguin
- Q2: What illuminated word appears on the roof of a london cab? A: Taxi
- Q3: What type of sandwich is typically made with three layers of bread? A: Club
- Link: Biscuits (Penguin, Taxi, and Club are all popular UK chocolate biscuits).

Now, generate a new, unique puzzle for today (Puzzle ID ${puzzleId}) following the clever, indirect logic of the Gold-Standard Examples. The puzzle must have:
1. 't': A question with a single, definitive, common-knowledge answer.
2. 'a': The single-word answer.
3. 'h': A clever, one-sentence hint that does not contain the answer.
The final 'link' must be the category that connects the three answers and MUST be a single word.
Also provide a 'link_hint' for the final link.`;
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "questions": {
                        "type": "ARRAY",
                        "items": { "type": "OBJECT", "properties": { "t": { "type": "STRING" }, "a": { "type": "STRING" }, "h": { "type": "STRING" } }, "required": ["t", "a", "h"] }
                    },
                    "link": { "type": "STRING" },
                    "link_hint": { "type": "STRING" }
                },
                required: ["questions", "link", "link_hint"]
            }
        }
    };

    let puzzleData;
    try {
        const geminiResponse = await fetch(geminiUrl, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });
        
        const responseBodyText = await geminiResponse.text();
        if (!geminiResponse.ok) {
            console.error("Gemini API Error:", responseBodyText);
            throw new Error(`Gemini API failed with status: ${geminiResponse.status}`);
        }
        
        const geminiResult = JSON.parse(responseBodyText);
        
        const rawText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            console.error("Full Gemini Result (for debugging):", JSON.stringify(geminiResult, null, 2));
            throw new Error("Received empty or invalid response from Gemini API.");
        }

        puzzleData = JSON.parse(rawText);
        console.log("Successfully generated puzzle from Gemini.");
    } catch (error) {
        console.error("Error in Step 1 (Gemini):", error);
        return { statusCode: 500, body: "Failed to generate puzzle from Gemini." };
    }

    // --- Step 2: Authenticate with the Firebase REST API ---
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
        console.log("Successfully authenticated with Firebase.");
    } catch (error) {
        console.error("Error in Step 2 (Firebase Auth):", error);
        return { statusCode: 500, body: "Failed to authenticate with Firebase." };
    }

    // --- Step 3: Save the new puzzle to the Firestore database ---
    // ** THE FIX IS HERE: The puzzleId is now part of the URL path, not a query parameter. **
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
        console.log("Successfully saved puzzle to Firestore.");
    } catch (error) {
        console.error("Error in Step 3 (Firestore Save):", error);
        return { statusCode: 500, body: "Failed to save puzzle to database." };
    }

    return {
        statusCode: 200,
        body: `Successfully generated and stored puzzle #${puzzleId}.`
    };
};
