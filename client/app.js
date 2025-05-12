const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerInfoDisplay = document.getElementById('playerInfo');
const scoreBoardDisplay = document.getElementById('scoreBoard');
const selectionInfoDisplay = document.getElementById('selectionInfo');
const pauseInfoDisplay = document.getElementById('pauseInfo'); // Get pause element

// --- Default values (used before first server message) ---
const DEFAULT_PLAYER_RADIUS = 15;
const DEFAULT_BALL_RADIUS = 10;

const socket = new WebSocket('ws://localhost:8080'); // Change if deployed

let localGameState = { // Structure matches server state (keys: b, p1, p2, s, p, gs)
    b: { x: 350, y: 225, r: DEFAULT_BALL_RADIUS, vx: 0, vy: 0 },
    p1: [], p2: [],
    s: { player1: 0, player2: 0 },
    p: false, // Paused state
    gs: { canvasWidth: 700, canvasHeight: 450, goal1:{}, goal2:{} }
};
let myPlayerNumber = null; // 'player1' or 'player2'
let myTeam = []; // Reference to my team's player array
let selectedPlayer = null; // Locally selected player object reference { id, x, y, r, ... }

// --- Input Handling (Tap Only) ---

canvas.addEventListener('click', handleTap); // Use click for mouse fallback
canvas.addEventListener('touchstart', handleTap, { passive: false });

function handleTap(e) {
    // Ignore taps if game is paused or not assigned a player
    if (localGameState.p || !myPlayerNumber) {
        console.log("Input ignored: Game paused or not assigned.");
        return;
    }

    const pos = getCanvasRelativePos(e);
    if (!pos) return; // Exit if position couldn't be determined

    // 1. Check if tap hit one of MY players
    let tappedPlayer = null;
    for (const p of myTeam) {
        const dx = pos.x - p.x;
        const dy = pos.y - p.y;
        // Use the radius received from the server state (p.r)
        if (dx * dx + dy * dy < p.r * p.r) {
            tappedPlayer = p;
            break;
        }
    }

    if (tappedPlayer) {
        // --- Tapped ON a player: Select this player ---
        selectedPlayer = tappedPlayer;
        console.log(`Selected player ID: ${selectedPlayer.id}`);
        drawGame(); // Redraw to show new selection highlight
        e.preventDefault(); // Prevent potential double actions (like mouse event after touch)

    } else if (selectedPlayer) {
        // --- Tapped ELSEWHERE while a player IS selected: Shoot! ---
        // Calculate direction vector from selected player towards tap position
        const shootDx = pos.x - selectedPlayer.x;
        const shootDy = pos.y - selectedPlayer.y;

        const dist = Math.sqrt(shootDx * shootDx + shootDy * shootDy);

        // Send kick message only if tap is reasonably far (prevents accidental shots on deselect)
        if (dist > (selectedPlayer.r || DEFAULT_PLAYER_RADIUS)) { // Shoot if tap is outside player radius
            console.log(`Shooting player ${selectedPlayer.id} towards (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);
            socket.send(JSON.stringify({
                type: 'kick',
                playerId: selectedPlayer.id,
                dx: shootDx, // Send direction vector
                dy: shootDy
            }));
             // Keep player selected after shooting? Yes, allows quick follow-up shots.
            // selectedPlayer = null; // Optional: Deselect after shooting
        } else {
            console.log("Tap too close to selected player, not shooting.");
             // Tapped near selected player - deselect?
             // selectedPlayer = null;
        }
        // drawGame(); // Redraw might be needed if deselection happens

    } else {
        // --- Tapped ELSEWHERE and NO player selected: Do Nothing ---
        console.log("Tap on empty space, no player selected.");
    }
}

// Helper to get mouse/touch position relative to canvas (same as before)
function getCanvasRelativePos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
         clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY;
    } else if (e.clientX !== undefined) { // Mouse event
        clientX = e.clientX; clientY = e.clientY;
    } else {
        return null; // No coordinates found
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
}

// --- WebSocket Handlers ---

socket.onopen = () => { /* ... (same as before) ... */
     console.log('Connected to WebSocket server.');
     playerInfoDisplay.textContent = "Connected. Waiting for opponent...";
};

socket.onmessage = (event) => {
    try {
        const newState = JSON.parse(event.data);

        if (newState.type === 'playerAssignment') {
            myPlayerNumber = newState.player;
            playerInfoDisplay.textContent = `You are ${myPlayerNumber === 'player1' ? 'Player 1 (Blue)' : 'Player 2 (Red)'}`;
            selectionInfoDisplay.style.display = 'block';
            console.log("Assigned as:", myPlayerNumber);

        } else if (newState.type === 'gameState') {
            localGameState = newState; // Update entire local state

            // Update canvas size if necessary
            if (canvas.width !== localGameState.gs.canvasWidth || canvas.height !== localGameState.gs.canvasHeight) {
                 canvas.width = localGameState.gs.canvasWidth;
                 canvas.height = localGameState.gs.canvasHeight;
            }

            // Update my team reference
            myTeam = (myPlayerNumber === 'player1') ? localGameState.p1 : localGameState.p2;

            // *** Update selectedPlayer reference ***
            // If we had a player selected, find its updated object in the new state
            if (selectedPlayer) {
                const updatedSelected = myTeam.find(p => p.id === selectedPlayer.id);
                if (updatedSelected) {
                    selectedPlayer = updatedSelected; // Keep reference to the new object
                } else {
                    selectedPlayer = null; // Player disappeared? Deselect.
                }
            } // else: no player was selected, nothing to update

            // Update UI
            scoreBoardDisplay.textContent = `Score: P1: ${localGameState.s.player1} - P2: ${localGameState.s.player2}`;
            // Show/Hide Pause Info
            pauseInfoDisplay.style.display = localGameState.p ? 'block' : 'none';
            if (localGameState.p) {
                 selectionInfoDisplay.style.display = 'none'; // Hide selection info when paused
            } else if (myPlayerNumber) {
                 selectionInfoDisplay.style.display = 'block';
            }


            drawGame(); // Draw the latest state

        } else if (newState.type === 'message') {
            // ... (handle general messages same as before) ...
             if (!myPlayerNumber) { playerInfoDisplay.textContent = newState.message; }
             console.log("Server message:", newState.message);
        }
    } catch (error) {
        console.error("Failed to parse message or update state:", error, event.data);
    }
};

socket.onclose = () => { /* ... (same, ensure selectedPlayer = null) ... */
    console.log('Disconnected from WebSocket server.');
    playerInfoDisplay.textContent = "Disconnected. Try refreshing.";
    selectionInfoDisplay.style.display = 'none';
    pauseInfoDisplay.style.display = 'none';
    selectedPlayer = null;
};
socket.onerror = (error) => { /* ... (same) ... */
    console.error('WebSocket Error:', error);
    playerInfoDisplay.textContent = "Connection Error. See console.";
    selectedPlayer = null;
};


// --- Drawing Logic ---

// --- Fake 3D Drawing Functions ---
function drawFake3DPuck(x, y, radius, color, isSelected) {
    // Base color
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Highlight (top-left)
    const highlightOffset = radius * 0.15;
    const highlightRadius = radius * 0.7;
    const gradH = ctx.createRadialGradient(
        x - highlightOffset, y - highlightOffset, radius * 0.1,
        x - highlightOffset, y - highlightOffset, highlightRadius
    );
    gradH.addColorStop(0, 'rgba(255,255,255,0.7)');
    gradH.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradH;
    ctx.beginPath();
    ctx.arc(x - highlightOffset, y - highlightOffset, highlightRadius, 0, Math.PI * 2);
    ctx.fill();

    // Shadow (bottom-right)
    const shadowOffset = radius * 0.1;
    const shadowRadius = radius;
     const gradS = ctx.createRadialGradient(
        x + shadowOffset, y + shadowOffset, radius * 0.6,
        x + shadowOffset, y + shadowOffset, shadowRadius
    );
    gradS.addColorStop(0, 'rgba(0,0,0,0.4)');
    gradS.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradS;
     ctx.beginPath();
    ctx.arc(x + shadowOffset, y + shadowOffset, shadowRadius, 0, Math.PI * 2);
    ctx.fill();


    // Selection Outline
    if (isSelected) {
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, Math.PI * 2); // Slightly outside
        ctx.stroke();
    }
}

function drawFake3DBall(x, y, radius) {
     // Base white
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    const highlightOffset = radius * 0.2;
    const highlightRadius = radius * 0.8;
    const gradH = ctx.createRadialGradient(
        x - highlightOffset, y - highlightOffset, 0,
        x - highlightOffset, y - highlightOffset, highlightRadius
    );
    gradH.addColorStop(0, 'rgba(230,230,255,0.9)'); // Slight blueish highlight
    gradH.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradH;
    ctx.beginPath();
    ctx.arc(x - highlightOffset, y - highlightOffset, highlightRadius, 0, Math.PI * 2);
    ctx.fill();

     // Shadow/Contour
    const shadowOffset = radius * 0.15;
    const shadowRadius = radius * 1.1;
     const gradS = ctx.createRadialGradient(
        x + shadowOffset, y + shadowOffset, radius * 0.5,
        x + shadowOffset, y + shadowOffset, shadowRadius
    );
    gradS.addColorStop(0, 'rgba(100,100,100,0.4)'); // Greyish shadow
    gradS.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradS;
     ctx.beginPath();
    ctx.arc(x + shadowOffset, y + shadowOffset, shadowRadius, 0, Math.PI * 2);
    ctx.fill();

     // Optional: Add soccer ball pattern lines (complex)
     // For simplicity, skipping detailed pattern
}

function drawGoal(goal) {
    if (!goal) return;
    const postWidth = 5;
    const crossbarHeight = 5;
    const depth = 8; // Fake depth offset

    ctx.fillStyle = '#CCCCCC'; // Goal post color (light grey)
    ctx.strokeStyle = '#AAAAAA'; // Darker outline
    ctx.lineWidth = 1;

    // Back "depth" rectangle first
    ctx.fillStyle = '#AAAAAA'; // Darker for back
    ctx.fillRect(goal.x + (goal.width > 0 ? depth : -depth), goal.y - depth, goal.width, goal.height + depth * 2);

    // Near side posts
     ctx.fillStyle = '#CCCCCC';
    ctx.fillRect(goal.x, goal.y - crossbarHeight, postWidth, goal.height + crossbarHeight * 2); // Left/Top post
    ctx.fillRect(goal.x + goal.width - postWidth, goal.y - crossbarHeight, postWidth, goal.height + crossbarHeight * 2); // Right/Bottom post
    // Crossbar
    ctx.fillRect(goal.x, goal.y - crossbarHeight, goal.width, crossbarHeight); // Top
    ctx.fillRect(goal.x, goal.y + goal.height, goal.width, crossbarHeight);    // Bottom


    // Draw net lines (simple crosshatch)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    const spacing = 10;
    for(let i = goal.y; i < goal.y + goal.height; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(goal.x, i);
        ctx.lineTo(goal.x + goal.width, i);
        ctx.stroke();
    }
     for(let i = goal.x; i < goal.x + goal.width; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, goal.y);
        ctx.lineTo(i, goal.y + goal.height);
        ctx.stroke();
    }
}
// --------------------------------


function drawGame() {
    const state = localGameState;
    if (!state || !state.gs) return;

    // Clear canvas
    ctx.clearRect(0, 0, state.gs.canvasWidth, state.gs.canvasHeight);

    // Draw Field lines (using state.gs)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); // Center line
    ctx.moveTo(state.gs.canvasWidth / 2, 0); ctx.lineTo(state.gs.canvasWidth / 2, state.gs.canvasHeight); ctx.stroke();
    ctx.beginPath(); // Center circle
    ctx.arc(state.gs.canvasWidth / 2, state.gs.canvasHeight / 2, 60, 0, Math.PI * 2); ctx.stroke();

    // Draw Goals (using state.gs)
    drawGoal(state.gs.goal1);
    drawGoal(state.gs.goal2);

    // Draw Ball (using state.b and its radius state.b.r)
    if (state.b) {
        drawFake3DBall(state.b.x, state.b.y, state.b.r || DEFAULT_BALL_RADIUS);
    }

    // Draw Players (using state.p1, state.p2 and player radius p.r)
    const drawTeam = (team, teamColor) => {
        if (!team) return;
        team.forEach((p, index) => {
            // Check if this player is the locally selected one
            const isSelected = (selectedPlayer && p.id === selectedPlayer.id);
            drawFake3DPuck(p.x, p.y, p.r || DEFAULT_PLAYER_RADIUS, teamColor, isSelected);

             // Draw player number (1-5) - Optional, can clutter the 3D look
             ctx.fillStyle = 'rgba(255,255,255,0.8)'; // Semi-transparent white
             ctx.font = 'bold 10px Arial'; // Smaller font
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillText(index + 1, p.x, p.y + 1); // Slight offset maybe
        });
    };

    drawTeam(state.p1, '#007bff'); // Bootstrap blue
    drawTeam(state.p2, '#dc3545'); // Bootstrap red


    // Display Goal/Pause Message Overlay if paused
    if (state.p) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Dark overlay
        ctx.fillRect(0, 0, state.gs.canvasWidth, state.gs.canvasHeight);

        ctx.fillStyle = 'white';
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GOAL!', state.gs.canvasWidth / 2, state.gs.canvasHeight / 2 - 20);
         ctx.font = '20px Arial';
        ctx.fillText('Restarting soon...', state.gs.canvasWidth / 2, state.gs.canvasHeight / 2 + 20);
    }
}

// Initial draw
canvas.width = localGameState.gs.canvasWidth;
canvas.height = localGameState.gs.canvasHeight;
drawGame();