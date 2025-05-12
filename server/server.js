// server/server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

let gameInterval;
let clients = []; // Array to store connected clients

// --- Game State (Very Simplified) ---
let ball = { x: 300, y: 200, radius: 10, vx: 0, vy: 0, color: 'white' };
let players = {
    player1: [ // Team 1
        { id: 'p1_1', x: 100, y: 100, radius: 15, color: 'blue', isSelected: false },
        { id: 'p1_2', x: 100, y: 300, radius: 15, color: 'blue', isSelected: false },
        // Add more players for team 1
    ],
    player2: [ // Team 2
        { id: 'p2_1', x: 500, y: 100, radius: 15, color: 'red', isSelected: false },
        { id: 'p2_2', x: 500, y: 300, radius: 15, color: 'red', isSelected: false },
        // Add more players for team 2
    ]
};
let score = { player1: 0, player2: 0 };
let turn = 'player1'; // 'player1' or 'player2'
let gameSettings = {
    canvasWidth: 600,
    canvasHeight: 400,
    goal1: { x: 0, y: 150, width: 20, height: 100 },
    goal2: { x: 580, y: 150, width: 20, height: 100 },
    friction: 0.98, // Slows down objects
    kickForceMultiplier: 0.1
};

console.log("WebSocket server started on port 8080");

wss.on('connection', (ws) => {
    const clientId = Date.now(); // Simple unique ID
    clients.push({ id: clientId, ws: ws, playerNumber: null });
    console.log(`Client ${clientId} connected.`);

    // Assign player number (very basic - first two connections)
    if (clients.length === 1) {
        clients[0].playerNumber = 'player1';
        ws.send(JSON.stringify({ type: 'playerAssignment', player: 'player1', message: "You are Player 1 (Blue)" }));
    } else if (clients.length === 2) {
        clients[1].playerNumber = 'player2';
        ws.send(JSON.stringify({ type: 'playerAssignment', player: 'player2', message: "You are Player 2 (Red)" }));
        // Start game or send initial state when two players are connected
        broadcastGameState();
        if (!gameInterval) {
            startGameLoop();
        }
    } else {
        ws.send(JSON.stringify({ type: 'message', message: "Game is full or observer mode." }));
    }


    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Received from client ${clientId}:`, data);

            const client = clients.find(c => c.ws === ws);
            if (!client || !client.playerNumber) return; // Ignore messages from unassigned or unknown clients

            if (data.type === 'kick' && turn === client.playerNumber) {
                const { playerId, dx, dy } = data;
                handleKick(client.playerNumber, playerId, dx, dy);
                // Switch turn (simple turn-based, or could be real-time with cooldowns)
                // For simplicity, let's imagine the flick applies and then we wait for things to settle.
                // A more complex system would handle the physics over time.
                // turn = (turn === 'player1') ? 'player2' : 'player1'; // Switch turn after kick settles
                // For now, broadcast immediately. Physics loop will handle movement.
            } else if (data.type === 'selectPlayer') {
                if (turn === client.playerNumber) {
                    handlePlayerSelection(client.playerNumber, data.playerId);
                }
            }

        } catch (error) {
            console.error("Failed to parse message or handle action:", error);
        }
    });

    ws.on('close', () => {
        clients = clients.filter(c => c.ws !== ws);
        console.log(`Client ${clientId} disconnected.`);
        if (clients.length < 2 && gameInterval) {
            clearInterval(gameInterval);
            gameInterval = null;
            console.log("Game paused, waiting for players.");
            // Optionally reset game state here
        }
    });

    // Send initial game state to the newly connected client
    // (or wait until two players are connected)
    if (clients.length >= 2) {
        broadcastGameState();
    }
});

function handlePlayerSelection(playerTeam, selectedPlayerId) {
    // Deselect all players for the current team
    players[playerTeam].forEach(p => p.isSelected = false);
    // Select the new player
    const playerToSelect = players[playerTeam].find(p => p.id === selectedPlayerId);
    if (playerToSelect) {
        playerToSelect.isSelected = true;
    }
    broadcastGameState();
}

function handleKick(playerTeam, playerId, dx, dy) {
    const team = players[playerTeam];
    if (!team) return;

    const player = team.find(p => p.id === playerId && p.isSelected);
    if (player) {
        // Apply force (simplified)
        player.vx = dx * gameSettings.kickForceMultiplier;
        player.vy = dy * gameSettings.kickForceMultiplier;
        // console.log(`Player ${playerId} kicked with force (${player.vx}, ${player.vy})`);
    }
    // Server will update and broadcast. Turn switching should be handled more robustly.
    // For this example, we let the physics loop run and turn switching might be implicit
    // or handled after objects stop moving.
}


function updateGamePhysics() {
    let somethingMoved = false;

    // Update ball
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= gameSettings.friction;
    ball.vy *= gameSettings.friction;
    if (Math.abs(ball.vx) > 0.01 || Math.abs(ball.vy) > 0.01) somethingMoved = true;


    // Update players
    ['player1', 'player2'].forEach(teamKey => {
        players[teamKey].forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= gameSettings.friction;
            p.vy *= gameSettings.friction;
            if (Math.abs(p.vx) > 0.01 || Math.abs(p.vy) > 0.01) somethingMoved = true;


            // Boundary collisions for players
            if (p.x - p.radius < 0) { p.x = p.radius; p.vx *= -0.5; }
            if (p.x + p.radius > gameSettings.canvasWidth) { p.x = gameSettings.canvasWidth - p.radius; p.vx *= -0.5; }
            if (p.y - p.radius < 0) { p.y = p.radius; p.vy *= -0.5; }
            if (p.y + p.radius > gameSettings.canvasHeight) { p.y = gameSettings.canvasHeight - p.radius; p.vy *= -0.5; }
        });
    });

    // Collisions (very basic placeholder)
    handleCollisions();

    // Goal Check
    checkGoal();

    if (!somethingMoved && turn !== null) { // If nothing is moving and game is active
        // This is a very simplistic way to switch turns.
        // A better approach would be to wait for a "settled" state.
        // For now, if a kick happened and things stopped, THEN switch turn.
        // This needs to be refined. For a flick game, the turn ends when all pieces stop.
    }
}

function handleCollisions() {
    const allPucks = [...players.player1, ...players.player2, ball];

    for (let i = 0; i < allPucks.length; i++) {
        for (let j = i + 1; j < allPucks.length; j++) {
            const puckA = allPucks[i];
            const puckB = allPucks[j];

            const dx = puckB.x - puckA.x;
            const dy = puckB.y - puckA.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = puckA.radius + puckB.radius;

            if (distance < minDistance) {
                // Basic collision response: elastic collision
                // Normal vector
                const nx = dx / distance;
                const ny = dy / distance;

                // Tangent vector
                const tx = -ny;
                const ty = nx;

                // Dot product tangent
                const dpTanA = puckA.vx * tx + puckA.vy * ty;
                const dpTanB = puckB.vx * tx + puckB.vy * ty;

                // Dot product normal
                const dpNormA = puckA.vx * nx + puckA.vy * ny;
                const dpNormB = puckB.vx * nx + puckB.vy * ny;

                // Conservation of momentum in 1D (normal direction)
                // Assuming equal mass for simplicity here, otherwise use m1, m2
                const m1 = (puckA === ball) ? 0.5 : 1; // Ball is lighter
                const m2 = (puckB === ball) ? 0.5 : 1;

                const p = (dpNormA * m1 + dpNormB * m2) / (m1 + m2);
                const v1Prime = dpNormA + 2 * (p - dpNormA); // For puckA
                const v2Prime = dpNormB + 2 * (p - dpNormB); // For puckB


                puckA.vx = tx * dpTanA + nx * v1Prime;
                puckA.vy = ty * dpTanA + ny * v1Prime;
                puckB.vx = tx * dpTanB + nx * v2Prime;
                puckB.vy = ty * dpTanB + ny * v2Prime;

                // Separation to prevent sticking
                const overlap = 0.5 * (minDistance - distance);
                puckA.x -= overlap * nx;
                puckA.y -= overlap * ny;
                puckB.x += overlap * nx;
                puckB.y += overlap * ny;
            }
        }
    }

    // Boundary for ball
    if (ball.x - ball.radius < 0) {
        ball.x = ball.radius;
        ball.vx *= -0.7; // Dampen on wall hit
    }
    if (ball.x + ball.radius > gameSettings.canvasWidth) {
        ball.x = gameSettings.canvasWidth - ball.radius;
        ball.vx *= -0.7;
    }
    if (ball.y - ball.radius < 0) {
        ball.y = ball.radius;
        ball.vy *= -0.7;
    }
    if (ball.y + ball.radius > gameSettings.canvasHeight) {
        ball.y = gameSettings.canvasHeight - ball.radius;
        ball.vy *= -0.7;
    }
}


function checkGoal() {
    const { goal1, goal2, canvasWidth } = gameSettings;
    let goalScored = false;

    // Player 2 scores in Player 1's goal
    if (ball.x - ball.radius < goal1.x + goal1.width && // Ball's left edge past goal line
        ball.x + ball.radius > goal1.x &&             // Ball's right edge not past far post
        ball.y > goal1.y &&
        ball.y < goal1.y + goal1.height) {
        score.player2++;
        console.log("Goal for Player 2! Score:", score);
        goalScored = true;
        turn = 'player1'; // Player 1 starts next
    }
    // Player 1 scores in Player 2's goal
    else if (ball.x + ball.radius > goal2.x &&           // Ball's right edge past goal line
             ball.x - ball.radius < goal2.x + goal2.width && // Ball's left edge not past far post
             ball.y > goal2.y &&
             ball.y < goal2.y + goal2.height) {
        score.player1++;
        console.log("Goal for Player 1! Score:", score);
        goalScored = true;
        turn = 'player2'; // Player 2 starts next
    }

    if (goalScored) {
        resetPositions();
        broadcastGameState(); // Ensure score and turn update is sent
    }
}

function resetPositions() {
    ball.x = gameSettings.canvasWidth / 2;
    ball.y = gameSettings.canvasHeight / 2;
    ball.vx = 0;
    ball.vy = 0;

    // Reset player positions (example, could be more structured)
    players.player1[0] = { ...players.player1[0], x: 100, y: 100, vx: 0, vy: 0, isSelected: false };
    players.player1[1] = { ...players.player1[1], x: 100, y: 300, vx: 0, vy: 0, isSelected: false };
    players.player2[0] = { ...players.player2[0], x: gameSettings.canvasWidth - 100, y: 100, vx: 0, vy: 0, isSelected: false };
    players.player2[1] = { ...players.player2[1], x: gameSettings.canvasWidth - 100, y: 300, vx: 0, vy: 0, isSelected: false };

    // Potentially deselect all players
    players.player1.forEach(p => p.isSelected = false);
    players.player2.forEach(p => p.isSelected = false);
}


function broadcastGameState() {
    const state = {
        type: 'gameState',
        ball,
        players,
        score,
        turn,
        gameSettings
    };
    const jsonState = JSON.stringify(state);
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(jsonState);
        }
    });
}

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    gameInterval = setInterval(() => {
        if (clients.length >= 2) { // Only run if we have enough players
            updateGamePhysics();
            broadcastGameState();
        }
    }, 1000 / 60); // 60 FPS
}

// Initial call to reset positions if needed before game starts or on server restart
resetPositions();