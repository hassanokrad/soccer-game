// server/server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

let gameInterval;
let clients = [];

// --- Game State ---
const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;
const CANVAS_WIDTH = 700;
const CANVAS_HEIGHT = 450;
const GOAL_COOLDOWN_MS = 3000; // 3 seconds pause after goal

let ball = {
    id: 'ball', // Added ID for consistency
    x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2,
    radius: BALL_RADIUS, vx: 0, vy: 0, color: 'white'
};

function createInitialPlayers(teamId, teamColor, side) {
    const players = [];
    const y_spacing = CANVAS_HEIGHT / 6;
    const x_pos = (side === 'left') ? CANVAS_WIDTH * 0.2 : CANVAS_WIDTH * 0.8;
    for (let i = 0; i < 5; i++) {
        players.push({
            id: `${teamId}_${i+1}`,
            x: x_pos,
            y: y_spacing * (i + 1),
            radius: PLAYER_RADIUS, // Include radius here
            color: teamColor,
            vx: 0, vy: 0
        });
    }
    return players;
}

let players = {
    player1: createInitialPlayers('p1', 'blue', 'left'),
    player2: createInitialPlayers('p2', 'red', 'right')
};

let score = { player1: 0, player2: 0 };
let gamePaused = false; // Flag for goal cooldown
let pauseEndTime = 0;

let gameSettings = {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    goal1: { x: 0, y: CANVAS_HEIGHT * 0.3, width: 20, height: CANVAS_HEIGHT * 0.4 },
    goal2: { x: CANVAS_WIDTH - 20, y: CANVAS_HEIGHT * 0.3, width: 20, height: CANVAS_HEIGHT * 0.4 },
    friction: 0.98,
    kickForceMultiplier: 0.15, // Slightly increased force might feel better for tap-shoot
    maxSpeed: 15
};

console.log("Real-time Touch Soccer server started on port 8080");

wss.on('connection', (ws) => {
    // ... (Connection logic remains the same as before) ...
    const clientId = Date.now();
    let assignedPlayerNumber = null;

    if (clients.filter(c => c.playerNumber === 'player1').length === 0) {
        assignedPlayerNumber = 'player1';
    } else if (clients.filter(c => c.playerNumber === 'player2').length === 0) {
        assignedPlayerNumber = 'player2';
    }

    clients.push({ id: clientId, ws: ws, playerNumber: assignedPlayerNumber });
    console.log(`Client ${clientId} connected.`);

     if (assignedPlayerNumber) {
        ws.send(JSON.stringify({ type: 'playerAssignment', player: assignedPlayerNumber }));
        console.log(`Client ${clientId} assigned as ${assignedPlayerNumber}`);
    } else {
        ws.send(JSON.stringify({ type: 'message', message: "Observer mode." }));
    }

    if (clients.filter(c => c.playerNumber).length === 2 && !gameInterval) {
        console.log("Two players connected. Starting game loop.");
        resetGame(); // Reset score and positions when game starts
        startGameLoop();
    }

    broadcastGameState(ws); // Send initial state to new client


    ws.on('message', (message) => {
        try {
            // Ignore messages if game is paused during cooldown
            if (gamePaused) return;

            const data = JSON.parse(message);
            const client = clients.find(c => c.ws === ws);
            if (!client || !client.playerNumber) return;

            if (data.type === 'kick') {
                const { playerId, dx, dy } = data;
                handleKick(client.playerNumber, playerId, dx, dy);
            }

        } catch (error) {
            console.error(`Failed to process message from ${client?.playerNumber} (${clientId}):`, error);
        }
    });

    ws.on('close', () => {
        // ... (Disconnect logic remains the same) ...
        clients = clients.filter(c => c.ws !== ws);
        console.log(`Client ${clientId} (${assignedPlayerNumber || 'observer'}) disconnected.`);
        if (clients.filter(c => c.playerNumber).length < 2 && gameInterval) {
            clearInterval(gameInterval);
            gameInterval = null;
            gamePaused = false; // Ensure pause is reset if player leaves
            console.log("Game paused/stopped, waiting for players.");
        }
    });
});

function handleKick(playerTeam, playerId, dx, dy) {
    // ... (Kick logic is the same - applies force based on dx, dy) ...
    const team = players[playerTeam];
    if (!team) return;

    const player = team.find(p => p.id === playerId);
    if (player) {
        // Normalize the direction vector (dx, dy) and apply force
        const dist = Math.sqrt(dx * dx + dy * dy);
        let forceX = 0;
        let forceY = 0;
        if (dist > 0.1) { // Avoid division by zero / tiny kicks
             // Scale force by distance maybe? Or fixed impulse? Let's use fixed impulse + direction
             const kickStrength = 5; // Adjust this value for kick power
             forceX = (dx / dist) * kickStrength;
             forceY = (dy / dist) * kickStrength;

            // Apply impulse directly to velocity
            player.vx += forceX;
            player.vy += forceY;
        }


        // Clamp velocity
        clampVelocity(player);
    } else {
        console.warn(`Player ${playerId} not found for team ${playerTeam} during kick.`);
    }
}

function updateGamePhysics() {
    const allPucks = [...players.player1, ...players.player2, ball];

    // Update positions and apply friction
     allPucks.forEach(p => {
        if (!p) return; // Safety check
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= gameSettings.friction;
        p.vy *= gameSettings.friction;
        if (Math.abs(p.vx) < 0.05) p.vx = 0;
        if (Math.abs(p.vy) < 0.05) p.vy = 0;
    });


    handleCollisions(allPucks);
    checkBoundaries(allPucks);
    checkGoal(); // Checks for goal and initiates pause if needed
}

// --- Collision, Boundary, ClampVelocity functions remain the same ---
function handleCollisions(allPucks) {
     // Simple Circle-Circle Collision Response
    for (let i = 0; i < allPucks.length; i++) {
        for (let j = i + 1; j < allPucks.length; j++) {
            const puckA = allPucks[i];
            const puckB = allPucks[j];
             if (!puckA || !puckB) continue; // Safety check

            const dx = puckB.x - puckA.x;
            const dy = puckB.y - puckA.y;
            const distanceSq = dx * dx + dy * dy; // Use squared distance
            const minDistance = puckA.radius + puckB.radius;
            const minDistanceSq = minDistance * minDistance;

            if (distanceSq < minDistanceSq && distanceSq > 0.001) { // Check for overlap and avoid division by zero
                const distance = Math.sqrt(distanceSq);
                // Normal vector (normalized)
                const nx = dx / distance;
                const ny = dy / distance;

                // --- Resolve overlap ---
                const overlap = (minDistance - distance) * 0.5; // How much to move each puck
                puckA.x -= overlap * nx;
                puckA.y -= overlap * ny;
                puckB.x += overlap * nx;
                puckB.y += overlap * ny;

                // --- Collision response (using relative velocity) ---
                 // Relative velocity
                const rvx = puckA.vx - puckB.vx;
                const rvy = puckA.vy - puckB.vy;

                // Velocity component along the normal
                const velAlongNormal = rvx * nx + rvy * ny;

                // Do not resolve if velocities are separating
                if (velAlongNormal > 0) continue;

                // Calculate impulse scalar (simplified elastic collision, assuming mass = radius^2 for differentiation)
                const massA = (puckA.id === 'ball' ? BALL_RADIUS : PLAYER_RADIUS) ** 2; // Use consistent radii
                const massB = (puckB.id === 'ball' ? BALL_RADIUS : PLAYER_RADIUS) ** 2;
                const restitution = 0.8; // Bounciness (0-1)

                let impulseScalar = -(1 + restitution) * velAlongNormal;
                impulseScalar /= (1 / massA + 1 / massB);

                // Apply impulse
                const impulseX = impulseScalar * nx;
                const impulseY = impulseScalar * ny;

                puckA.vx += (1 / massA) * impulseX;
                puckA.vy += (1 / massA) * impulseY;
                puckB.vx -= (1 / massB) * impulseX;
                puckB.vy -= (1 / massB) * impulseY;

                 // Clamp velocities after collision
                clampVelocity(puckA);
                clampVelocity(puckB);

            }
        }
    }
}
function clampVelocity(puck) {
     if (!puck) return;
     const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        if (speed > gameSettings.maxSpeed) {
            const factor = gameSettings.maxSpeed / speed;
            puck.vx *= factor;
            puck.vy *= factor;
        }
}
function checkBoundaries(allPucks) {
    allPucks.forEach(p => {
        if (!p) return; // Safety check
        let bounced = false;
        const restitution = 0.6; // How much energy is lost on bounce
        const goal1 = gameSettings.goal1;
        const goal2 = gameSettings.goal2;
        const isBall = (p.id === 'ball'); // Check if the current puck is the ball

        // --- Top / Bottom Wall Collision (Same for Ball and Players) ---
        if (p.y - p.radius < 0) {
            p.y = p.radius;
            p.vy *= -restitution;
            bounced = true;
        }
        if (p.y + p.radius > gameSettings.canvasHeight) {
            p.y = gameSettings.canvasHeight - p.radius;
            p.vy *= -restitution;
            bounced = true;
        }

        // --- Left Wall / Goal 1 Collision ---
        if (p.x - p.radius < 0) {
            // Allow ball to enter goal if within vertical bounds
            if (isBall && p.y > goal1.y && p.y < goal1.y + goal1.height) {
                // Ball is entering goal - goal check will handle scoring. Don't bounce here.
                // But DO prevent it going through the *back* of the net (if x gets way too small)
                if (p.x < -p.radius * 2) { // Heuristic: prevent deep goal penetration
                     p.x = -p.radius * 2;
                     p.vx = 0; // Stop it
                }
            } else {
                // Player hits goal line OR Ball hits wall outside goal height: Bounce.
                p.x = p.radius;
                p.vx *= -restitution;
                bounced = true;
            }
        }

        // --- Right Wall / Goal 2 Collision ---
        if (p.x + p.radius > gameSettings.canvasWidth) {
             // Allow ball to enter goal if within vertical bounds
             if (isBall && p.y > goal2.y && p.y < goal2.y + goal2.height) {
                 // Ball is entering goal. Prevent deep penetration.
                 if (p.x > gameSettings.canvasWidth + p.radius * 2) {
                     p.x = gameSettings.canvasWidth + p.radius * 2;
                     p.vx = 0;
                 }
            } else {
                 // Player hits goal line OR Ball hits wall outside goal height: Bounce.
                p.x = gameSettings.canvasWidth - p.radius;
                p.vx *= -restitution;
                bounced = true;
            }
        }

        // Clamp velocity if a bounce occurred
        if (bounced) clampVelocity(p);
    });
}

// ---------------------------------------------------------------------

function checkGoal() {
    const { goal1, goal2 } = gameSettings;
    let goalScored = false;

    // Check goal 1 (P2 scores)
    if (ball.x < goal1.x + goal1.width && // Center of ball past goal line
        ball.y > goal1.y && ball.y < goal1.y + goal1.height)
    {
        score.player2++;
        console.log(`Goal P2! Score: ${score.player1}-${score.player2}`);
        goalScored = true;
    }
    // Check goal 2 (P1 scores)
    else if (ball.x > goal2.x && // Center of ball past goal line
             ball.y > goal2.y && ball.y < goal2.y + goal2.height)
    {
        score.player1++;
        console.log(`Goal P1! Score: ${score.player1}-${score.player2}`);
        goalScored = true;
    }

    if (goalScored) {
        gamePaused = true; // Pause the game
        pauseEndTime = Date.now() + GOAL_COOLDOWN_MS;
        console.log(`Game paused for ${GOAL_COOLDOWN_MS / 1000}s`);
        resetPositionsAfterGoal(); // Reset positions
        broadcastGameState(); // Broadcast the score update and paused state
    }
}

function resetPositionsAfterGoal() {
    // Reset ball
    ball.x = gameSettings.canvasWidth / 2;
    ball.y = gameSettings.canvasHeight / 2;
    ball.vx = 0; ball.vy = 0;
    // Reset players
    players.player1 = createInitialPlayers('p1', 'blue', 'left');
    players.player2 = createInitialPlayers('p2', 'red', 'right');
}

function resetGame() { // Full reset
     score.player1 = 0; score.player2 = 0;
     resetPositionsAfterGoal();
     gamePaused = false; // Ensure not paused on full reset
     pauseEndTime = 0;
     console.log("Game reset.");
     // Don't broadcast here, let the calling context do it if needed
}

function broadcastGameState(targetWs = null) {
    // Ensure radii are included!
    const mapPlayerState = p => ({
        id: p.id,
        x: parseFloat(p.x.toFixed(1)), y: parseFloat(p.y.toFixed(1)),
        vx: parseFloat(p.vx.toFixed(1)), vy: parseFloat(p.vy.toFixed(1)),
        r: p.radius // Include radius!
    });

    const state = {
        type: 'gameState',
        b: { // Ball state
            id: ball.id,
            x: parseFloat(ball.x.toFixed(1)), y: parseFloat(ball.y.toFixed(1)),
            vx: parseFloat(ball.vx.toFixed(1)), vy: parseFloat(ball.vy.toFixed(1)),
            r: ball.radius // Include radius!
         },
        p1: players.player1.map(mapPlayerState),
        p2: players.player2.map(mapPlayerState),
        s: score,
        p: gamePaused, // Paused state (boolean)
        gs: gameSettings // Send settings (client needs dimensions etc.)
    };
    const jsonState = JSON.stringify(state);

    if (targetWs) {
        if (targetWs.readyState === WebSocket.OPEN) targetWs.send(jsonState);
    } else {
        clients.forEach(client => {
            if (client.ws.readyState === WebSocket.OPEN) client.ws.send(jsonState);
        });
    }
}

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    console.log("Starting game loop (60Hz)");
    gameInterval = setInterval(() => {
        if (clients.filter(c => c.playerNumber).length < 2) {
             clearInterval(gameInterval); gameInterval = null; return;
        }

        const now = Date.now();
        // Check if game should unpause
        if (gamePaused && now > pauseEndTime) {
            gamePaused = false;
            console.log("Game unpaused.");
            // Broadcast unpaused state immediately before physics run
             broadcastGameState();
        }

        // Only run physics and broadcast if not paused
        if (!gamePaused) {
            updateGamePhysics();
            broadcastGameState(); // Broadcast updated state
        }
        // If paused, do nothing this tick (effectively pauses physics/updates)

    }, 1000 / 60); // ~60 FPS
}