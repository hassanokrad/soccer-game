const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerInfoDisplay = document.getElementById('playerInfo');
const scoreBoardDisplay = document.getElementById('scoreBoard');
const turnInfoDisplay = document.getElementById('turnInfo');

const socket = new WebSocket('ws://localhost:8080'); // Change to your server address if deployed

let localGameState = {
    ball: {},
    players: { player1: [], player2: [] },
    score: { player1: 0, player2: 0 },
    turn: '',
    gameSettings: { canvasWidth: 600, canvasHeight: 400 } // Default, will be updated
};
let myPlayerNumber = null; // 'player1' or 'player2'
let selectedPlayer = null; // Store the locally selected player object
let isDragging = false;
let dragStartX, dragStartY;

canvas.addEventListener('mousedown', (e) => {
    if (!myPlayerNumber || localGameState.turn !== myPlayerNumber || !selectedPlayer) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if the click is on the selected player
    const dx = mouseX - selectedPlayer.x;
    const dy = mouseY - selectedPlayer.y;
    if (Math.sqrt(dx*dx + dy*dy) < selectedPlayer.radius) {
        isDragging = true;
        dragStartX = selectedPlayer.x; // Store original position of player for line
        dragStartY = selectedPlayer.y;
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDragging || !selectedPlayer) return;
    // We don't move the player here, just draw the aim line
    drawGame(localGameState); // Redraw to show aim line
});

canvas.addEventListener('mouseup', (e) => {
    if (!isDragging || !selectedPlayer || !myPlayerNumber || localGameState.turn !== myPlayerNumber) {
        isDragging = false;
        return;
    }
    isDragging = false;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate flick vector (from player towards mouse release, but inverted for force)
    const flickDx = selectedPlayer.x - mouseX;
    const flickDy = selectedPlayer.y - mouseY;

    console.log(`Flicking player ${selectedPlayer.id} with dx: ${flickDx}, dy: ${flickDy}`);
    socket.send(JSON.stringify({
        type: 'kick',
        playerId: selectedPlayer.id,
        dx: flickDx,
        dy: flickDy
    }));
    // Selected player remains selected until server confirms or physics moves it.
    // Or deselect after kick: selectedPlayer = null;
});

canvas.addEventListener('click', (e) => {
    if (isDragging) return; // Avoid selection if it was part of a drag-release
    if (!myPlayerNumber || localGameState.turn !== myPlayerNumber) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Allow selecting a player of my team
    const myTeamPlayers = localGameState.players[myPlayerNumber];
    if (!myTeamPlayers) return;

    let clickedOnPlayer = null;
    for (const p of myTeamPlayers) {
        const dist = Math.sqrt((mouseX - p.x) ** 2 + (mouseY - p.y) ** 2);
        if (dist < p.radius) {
            clickedOnPlayer = p;
            break;
        }
    }

    if (clickedOnPlayer) {
        if (selectedPlayer && selectedPlayer.id === clickedOnPlayer.id) {
            // Clicked on already selected player - could deselect, or do nothing
        } else {
            selectedPlayer = clickedOnPlayer; // Locally update for immediate feedback
            // Notify server about selection
            socket.send(JSON.stringify({ type: 'selectPlayer', playerId: clickedOnPlayer.id }));
            console.log("Selected player:", selectedPlayer.id);
        }
    } else {
        // Clicked on empty space, maybe deselect
        // selectedPlayer = null;
        // socket.send(JSON.stringify({ type: 'selectPlayer', playerId: null }));
    }
    drawGame(localGameState); // Redraw to show selection
});


socket.onopen = () => {
    console.log('Connected to WebSocket server.');
    playerInfoDisplay.textContent = "Connected to server. Waiting for opponent...";
};

socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'playerAssignment') {
        myPlayerNumber = message.player;
        playerInfoDisplay.textContent = message.message;
        console.log("Assigned as:", myPlayerNumber);
    } else if (message.type === 'gameState') {
        localGameState = message; // Update local state with server's state
        canvas.width = localGameState.gameSettings.canvasWidth;
        canvas.height = localGameState.gameSettings.canvasHeight;

        // Update UI elements
        scoreBoardDisplay.textContent = `Score: P1: ${localGameState.score.player1} - P2: ${localGameState.score.player2}`;
        if (myPlayerNumber) {
            turnInfoDisplay.textContent = (localGameState.turn === myPlayerNumber) ? "Your Turn" : "Opponent's Turn";
            if (localGameState.turn === myPlayerNumber && !selectedPlayer) {
                // Auto-select first available player if none is selected and it's my turn
                // (or implement a more sophisticated selection retention)
                const myTeam = localGameState.players[myPlayerNumber];
                if (myTeam && myTeam.length > 0) {
                    const previouslySelected = myTeam.find(p => p.isSelected);
                    if (previouslySelected) {
                        selectedPlayer = previouslySelected;
                    }
                    // else if (!myTeam.some(p => p.isSelected)) {
                    //    // If server doesn't preserve selection well, re-select here
                    //    // selectedPlayer = myTeam[0];
                    //    // socket.send(JSON.stringify({ type: 'selectPlayer', playerId: selectedPlayer.id }));
                    // }
                }
            } else if (localGameState.turn !== myPlayerNumber) {
                 // It's not my turn, ensure no player is "locally" selected for input
                 // Server's `isSelected` flag should be the source of truth for drawing selection.
            }
        } else {
            turnInfoDisplay.textContent = "Observing game...";
        }


        // Update the reference to the selected player object from the new game state
        if (myPlayerNumber && localGameState.players[myPlayerNumber]) {
            const currentSelectedFromServer = localGameState.players[myPlayerNumber].find(p => p.isSelected);
            if (currentSelectedFromServer) {
                selectedPlayer = currentSelectedFromServer;
            } else {
                selectedPlayer = null; // If server indicates no player is selected for my team
            }
        }


        drawGame(localGameState);
    } else if (message.type === 'message') {
        playerInfoDisplay.textContent = message.message;
        console.log("Server message:", message.message);
    }
};

socket.onclose = () => {
    console.log('Disconnected from WebSocket server.');
    playerInfoDisplay.textContent = "Disconnected. Try refreshing.";
    turnInfoDisplay.textContent = "Game Over or Connection Lost";
};

socket.onerror = (error) => {
    console.error('WebSocket Error:', error);
    playerInfoDisplay.textContent = "Connection Error. See console.";
};

function drawGame(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Field lines (simple center line and circle)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    // Center line
    ctx.beginPath();
    ctx.moveTo(state.gameSettings.canvasWidth / 2, 0);
    ctx.lineTo(state.gameSettings.canvasWidth / 2, state.gameSettings.canvasHeight);
    ctx.stroke();
    // Center circle
    ctx.beginPath();
    ctx.arc(state.gameSettings.canvasWidth / 2, state.gameSettings.canvasHeight / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Goals
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    const { goal1, goal2 } = state.gameSettings;
    if (goal1) ctx.fillRect(goal1.x, goal1.y, goal1.width, goal1.height);
    if (goal2) ctx.fillRect(goal2.x, goal2.y, goal2.width, goal2.height);


    // Draw Ball
    if (state.ball) {
        ctx.beginPath();
        ctx.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = state.ball.color || 'white';
        ctx.fill();
        ctx.closePath();
    }

    // Draw Players
    ['player1', 'player2'].forEach(teamKey => {
        if (state.players[teamKey]) {
            state.players[teamKey].forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();

                // Highlight selected player for the current turn's player
                if (p.isSelected && myPlayerNumber === state.turn && p.id === selectedPlayer?.id) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
                ctx.closePath();
            });
        }
    });

    // Draw aiming line if dragging
    if (isDragging && selectedPlayer) {
        const rect = canvas.getBoundingClientRect();
        // Get current mouse position dynamically for the line
        // This requires canvas to have a mousemove listener that updates these:
        let currentMouseX, currentMouseY;
        // A bit of a hack for this example: get it from a temporary listener or store last mouse pos
        canvas.onmousemove = function(e) { // Re-assign for dynamic update during drag
             if (!isDragging) return;
             currentMouseX = e.clientX - rect.left;
             currentMouseY = e.clientY - rect.top;
             // Redraw only the aim line part or the whole scene
             // For simplicity, let's assume the main drawGame will be called or
             // draw this part specifically.
             // To avoid infinite loop, the main drawGame in mousemove should handle this.
        };
        // The actual drawing of the line if mouse positions are available:
        const tempCurrentMouseX = (event.clientX - rect.left); // Use event from mousemove if available
        const tempCurrentMouseY = (event.clientY - rect.top);

        if(tempCurrentMouseX && tempCurrentMouseY) {
            ctx.beginPath();
            ctx.moveTo(selectedPlayer.x, selectedPlayer.y);
            ctx.lineTo(tempCurrentMouseX, tempCurrentMouseY);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.closePath();

            // Draw arrowhead for direction
            const angle = Math.atan2(tempCurrentMouseY - selectedPlayer.y, tempCurrentMouseX - selectedPlayer.x);
            const arrowSize = 8;
            ctx.beginPath();
            ctx.moveTo(tempCurrentMouseX, tempCurrentMouseY);
            ctx.lineTo(tempCurrentMouseX - arrowSize * Math.cos(angle - Math.PI / 6), tempCurrentMouseY - arrowSize * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(tempCurrentMouseX, tempCurrentMouseY);
            ctx.lineTo(tempCurrentMouseX - arrowSize * Math.cos(angle + Math.PI / 6), tempCurrentMouseY - arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.closePath();
        }
    }
}

// Initial draw with default empty state (or loading state)
drawGame(localGameState);