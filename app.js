const GENRES = {
    28: "אקשן",
    12: "הרפתקה",
    16: "אנימציה",
    35: "קומדיה",
    80: "פשע",
    99: "דוקו",
    18: "דרמה",
    10751: "משפחה",
    14: "פנטזיה",
    36: "היסטוריה",
    27: "אימה",
    10402: "מוזיקה",
    9648: "מסתורין",
    10749: "רומנטיקה",
    878: "מד\"ב",
    53: "מתח",
    10752: "מלחמה",
    37: "מערבון"
};

class MovieRanker {
    constructor() {
        this.allMovies = []; // Starts empty, populated by TMDB API
        this.seenMovies = [];
        this.notSeenHistory = {}; // movieId -> timestamp
        this.watchlist = []; 
        this.eloScores = {};
        this.currentView = 'swipe';
        // Hardcoded API Key per user request
        this.tmdbKey = 'ec87e3d1438c3e8193530d6b09b21c26';
        this.currentMatch = null;
        
        // State
        this.selectedSwipeGenre = 'all';
        this.selectedBattleGenre = 'all';
        this.searchTimeout = null;
        this.RECURRENCE_DELAY = 48 * 60 * 60 * 1000;
        this.shuffledDeck = []; 
        this.loadedPages = {
            'movie/popular': 0,
            'movie/top_rated': 0,
            'discover/movie': 0,
            'movie/now_playing': 0
        };
        this.isFetching = false;
        
        this.cardStack = document.getElementById('card-stack');
        this.views = document.querySelectorAll('.view');
        this.navLinks = document.querySelectorAll('.nav-links li');
        
        this.init();
    }

    async init() {
        this.loadFromLocalStorage();
        this.setupNavigation();
        this.setupSwipeEvents();
        this.setupSearchEvents();
        this.setupGeneralEvents();
        this.renderGenreSelectors();
        this.renderCurrentView();
        
        if (this.tmdbKey) {
            await this.fetchMoviesMixed();
        }
        this.shuffleDeck(); 
    }

    // --- Data Management ---
    async fetchMoviesMixed(batchSize = 5) {
        if (!this.tmdbKey || this.isFetching) return;
        this.isFetching = true;
        
        try {
            const endpoints = [
                'movie/popular',
                'movie/top_rated',
                'discover/movie',
                'movie/now_playing'
            ];

            for (const endpoint of endpoints) {
                // Fetch several pages at once
                for (let i = 0; i < batchSize; i++) {
                    this.loadedPages[endpoint]++;
                    const page = this.loadedPages[endpoint];
                    
                    let extraParams = '';
                    if (endpoint.includes('discover')) {
                        extraParams = '&sort_by=vote_count.desc&vote_count.gte=100';
                    } else if (endpoint.includes('popular')) {
                        // Mix it up after page 10 to find hidden gems
                        if (page > 10) extraParams = '&sort_by=popularity.desc';
                    }
                    
                    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${this.tmdbKey}&language=he-IL&page=${page}${extraParams}`;
                    const response = await fetch(url);
                    const data = await response.json();
                    
                    if (data.results) {
                        data.results.forEach(movie => {
                            // Filter for English and Hebrew films as requested
                            if (movie.original_language === 'en' || movie.original_language === 'he') {
                                this.addMovieToPool({
                                    id: movie.id,
                                    title: movie.original_title,
                                    hebrew_title: movie.title,
                                    poster_path: movie.poster_path,
                                    genre_ids: movie.genre_ids,
                                    release_date: movie.release_date
                                });
                            }
                        });
                    }
                }
            }
            this.shuffleDeck();
            this.renderCurrentView();
        } catch (e) {
            console.error("Failed to fetch from TMDB:", e);
        } finally {
            this.isFetching = false;
        }
    }

    addMovieToPool(movie) {
        if (!this.allMovies.find(m => m.id === movie.id)) {
            this.allMovies.push(movie);
            if (!this.eloScores[movie.id]) this.eloScores[movie.id] = 1000;
        }
    }

    loadFromLocalStorage() {
        const savedData = localStorage.getItem('movieRankerData');
        if (savedData) {
            const data = JSON.parse(savedData);
            this.seenMovies = data.seenMovies || [];
            this.notSeenHistory = data.notSeenHistory || {};
            this.watchlist = data.watchlist || [];
            this.eloScores = data.eloScores || {};
            if (data.tmdbKey && data.tmdbKey.length > 10) this.tmdbKey = data.tmdbKey;
        }

        this.allMovies.forEach(m => {
            if (!this.eloScores[m.id]) this.eloScores[m.id] = 1000;
        });
    }

    saveToLocalStorage() {
        const data = {
            seenMovies: this.seenMovies,
            notSeenHistory: this.notSeenHistory,
            watchlist: this.watchlist,
            eloScores: this.eloScores,
            tmdbKey: this.tmdbKey
        };
        localStorage.setItem('movieRankerData', JSON.stringify(data));
        this.updateCounts();
    }

    updateCounts() {
        const seenSpan = document.getElementById('seen-count');
        if (seenSpan) seenSpan.textContent = this.seenMovies.length;
    }

    // --- Navigation & UI ---
    setupNavigation() {
        this.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const targetView = link.getAttribute('data-view');
                this.switchView(targetView);
            });
        });
    }

    switchView(viewId) {
        this.currentView = viewId;
        this.navLinks.forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`[data-view="${viewId}"]`);
        if (activeLink) activeLink.classList.add('active');
        
        this.views.forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`${viewId}-view`);
        if (targetView) targetView.classList.add('active');
        
        this.renderCurrentView();
    }

    renderGenreSelectors() {
        const swipeContainer = document.getElementById('swipe-genre-filter');
        const battleSelect = document.getElementById('battle-genre-filter');
        if (!swipeContainer || !battleSelect) return;

        swipeContainer.innerHTML = '<button class="genre-chip active" data-genre="all">הכל</button>';
        battleSelect.innerHTML = '<option value="all">כל הז\'אנרים</option>';
        
        Object.entries(GENRES).forEach(([id, name]) => {
            const chip = document.createElement('button');
            chip.className = 'genre-chip';
            chip.textContent = name;
            chip.dataset.genre = id;
            chip.onclick = () => {
                document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                this.selectedSwipeGenre = id;
                this.renderSwipe();
            };
            swipeContainer.appendChild(chip);

            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            battleSelect.appendChild(option);
        });

        battleSelect.onchange = (e) => {
            this.selectedBattleGenre = e.target.value;
            this.renderBattle();
        };

        const allChip = swipeContainer.querySelector('[data-genre="all"]');
        allChip.onclick = () => {
            document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
            allChip.classList.add('active');
            this.selectedSwipeGenre = 'all';
            this.renderSwipe();
        };
    }

    renderCurrentView() {
        if (this.currentView === 'swipe') this.renderSwipe();
        if (this.currentView === 'battle') this.renderBattle();
        if (this.currentView === 'stats') this.renderStats();
        if (this.currentView === 'watchlist') this.renderWatchlist();
        this.updateCounts();
    }

    // --- Swipe Logic ---
    renderSwipe() {
        this.cardStack.innerHTML = '';
        const now = Date.now();
        
        const filtered = this.shuffledDeck.filter(movie => {
            const isSeen = this.seenMovies.find(m => m.id === movie.id);
            const historyTime = this.notSeenHistory[movie.id];
            const isResting = historyTime && (Date.now() - historyTime < this.RECURRENCE_DELAY);
            const matchesGenre = this.selectedSwipeGenre === 'all' || 
                               (movie.genre_ids && movie.genre_ids.includes(parseInt(this.selectedSwipeGenre)));
            return !isSeen && !isResting && matchesGenre;
        });

        // Trigger background fetch if deck is low
        if (filtered.length < 15 && !this.isFetching) {
            this.fetchMoviesMixed(4); // Load 4 more pages for each category
        }

        if (filtered.length === 0) {
            this.cardStack.innerHTML = '<div class="stack-placeholder">טוען סרטים נוספים... נסה לשנות ז\'אנר או המתן רגע.</div>';
            return;
        }

        filtered.slice(0, 3).reverse().forEach((movie, index, arr) => {
            const isTop = (index === arr.length - 1);
            this.cardStack.appendChild(this.createMovieCard(movie, isTop));
        });
    }

    shuffleDeck() {
        this.shuffledDeck = [...this.allMovies].sort(() => Math.random() - 0.5);
    }

    createMovieCard(movie, isTop) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.dataset.id = movie.id;
        const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';
        const onWatchlist = this.watchlist.includes(movie.id);

        card.innerHTML = `
            ${onWatchlist ? '<div class="watchlist-badge">ברשימת צפייה</div>' : ''}
            <img src="${posterUrl}" alt="${movie.title}" loading="lazy">
            <div class="info">
                <h2>${movie.hebrew_title || movie.title}</h2>
                <div class="sub">${movie.title} ${movie.release_date ? '(' + movie.release_date.split('-')[0] + ')' : ''}</div>
            </div>
        `;
        if (isTop) this.makeDraggable(card);
        return card;
    }

    makeDraggable(el) {
        let startX, startY;
        let isDragging = false;
        const onStart = (e) => {
            isDragging = true;
            startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
            startY = (e.type === 'touchstart') ? e.touches[0].clientY : e.clientY;
            el.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const curX = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
            const curY = (e.type === 'touchmove') ? e.touches[0].clientY : e.clientY;
            const dx = curX - startX, dy = curY - startY;
            el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
            if (dy < -80) el.style.boxShadow = '0 10px 30px rgba(241, 196, 15, 0.4)';
            else if (dx > 50) el.style.boxShadow = '0 10px 30px rgba(46, 204, 113, 0.4)';
            else if (dx < -50) el.style.boxShadow = '0 10px 30px rgba(231, 76, 60, 0.4)';
            else el.style.boxShadow = '';
        };
        const onEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            const curX = (e.type === 'touchend') ? e.changedTouches[0].clientX : e.clientX;
            const curY = (e.type === 'touchend') ? e.changedTouches[0].clientY : e.clientY;
            const dx = curX - startX, dy = curY - startY;
            if (dy < -100) this.handleWatchlistAction(el);
            else if (dx > 100) this.swipe(el, 'right');
            else if (dx < -100) this.swipe(el, 'left');
            else { el.style.transition = '0.3s'; el.style.transform = ''; el.style.boxShadow = ''; }
        };
        el.onmousedown = onStart; window.onmousemove = onMove; window.onmouseup = onEnd;
        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd);
    }

    handleWatchlistAction(el) {
        const id = parseInt(el.dataset.id);
        if (!this.watchlist.includes(id)) {
            this.watchlist.push(id);
            this.saveToLocalStorage();
            el.classList.add('card-save-watchlist');
            setTimeout(() => { el.classList.remove('card-save-watchlist'); el.style.transform = ''; this.renderSwipe(); }, 500);
        } else {
            el.style.transition = '0.3s'; el.style.transform = '';
        }
    }

    swipe(el, direction) {
        const id = parseInt(el.dataset.id);
        const movie = this.allMovies.find(m => m.id === id);
        if (direction === 'right') {
            el.classList.add('card-exit-right');
            if (!this.seenMovies.find(m => m.id === id)) this.seenMovies.push(movie);
        } else {
            el.classList.add('card-exit-left');
            this.notSeenHistory[id] = Date.now();
        }
        this.saveToLocalStorage();
        setTimeout(() => this.renderSwipe(), 300);
    }

    setupSwipeEvents() {
        document.getElementById('swipe-no').onclick = () => {
            const top = this.cardStack.lastElementChild;
            if (top && !top.classList.contains('stack-placeholder')) this.swipe(top, 'left');
        };
        document.getElementById('swipe-yes').onclick = () => {
            const top = this.cardStack.lastElementChild;
            if (top && !top.classList.contains('stack-placeholder')) this.swipe(top, 'right');
        };
    }

    // --- Search Logic ---
    setupSearchEvents() {
        const input = document.getElementById('movie-search');
        const results = document.getElementById('search-results');
        if (!input || !results) return;

        input.oninput = (e) => {
            clearTimeout(this.searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) { results.style.display = 'none'; return; }
            this.searchTimeout = setTimeout(() => this.performSearch(query), 500);
        };
        document.onclick = (e) => { if (!e.target.closest('.search-box')) results.style.display = 'none'; };
    }

    async performSearch(query) {
        const resultsDiv = document.getElementById('search-results');
        resultsDiv.innerHTML = '<div class="search-item">מחפש...</div>';
        resultsDiv.style.display = 'block';

        let found = [];
        if (this.tmdbKey) {
            try {
                const url = `https://api.themoviedb.org/3/search/movie?api_key=${this.tmdbKey}&language=he-IL&query=${encodeURIComponent(query)}`;
                const res = await fetch(url);
                const data = await res.json();
                found = data.results || [];
            } catch (e) { console.error(e); }
        }

        const local = this.allMovies.filter(m => 
            m.title.toLowerCase().includes(query.toLowerCase()) || 
            (m.hebrew_title && m.hebrew_title.includes(query))
        );

        resultsDiv.innerHTML = '';
        const combined = [...local, ...found.filter(f => !local.find(l => l.id === f.id))].slice(0, 10);
        
        if (combined.length === 0) {
            resultsDiv.innerHTML = '<div class="search-item">לא נמצאו תוצאות</div>';
            return;
        }

        combined.forEach(movie => {
            const item = document.createElement('div');
            item.className = 'search-item';
            const imgUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` : 'https://via.placeholder.com/30x45';
            item.innerHTML = `
                <img src="${imgUrl}" alt="">
                <div>
                    <div>${movie.hebrew_title || movie.title || movie.original_title}</div>
                    <small style="color: grey">${movie.title || movie.original_title}</small>
                </div>
            `;
            item.onclick = () => {
                const movieObj = {
                    id: movie.id,
                    title: movie.title || movie.original_title,
                    hebrew_title: movie.hebrew_title || movie.title || movie.original_title,
                    poster_path: movie.poster_path,
                    genre_ids: movie.genre_ids,
                    release_date: movie.release_date
                };
                this.addMovieToPool(movieObj);
                if (!this.seenMovies.find(m => m.id === movie.id)) {
                    this.seenMovies.push(movieObj);
                    this.saveToLocalStorage();
                    alert(`נוסף לדירוג: ${movieObj.hebrew_title}`);
                }
                resultsDiv.style.display = 'none';
                document.getElementById('movie-search').value = '';
                this.renderCurrentView();
            };
            resultsDiv.appendChild(item);
        });
    }

    // --- Battle Logic ---
    renderBattle() {
        const arena = document.getElementById('battle-arena');
        const pool = this.seenMovies.filter(m => {
            if (this.selectedBattleGenre === 'all') return true;
            return m.genre_ids && m.genre_ids.includes(parseInt(this.selectedBattleGenre));
        });

        if (pool.length < 2) {
            arena.innerHTML = `<div class="stack-placeholder">צריך לפחות 2 סרטים שראית ב-"${GENRES[this.selectedBattleGenre] || 'ז\'אנר זה'}" כדי להלחם!</div>`;
            return;
        }

        const idxA = Math.floor(Math.random() * pool.length);
        let idxB = Math.floor(Math.random() * pool.length);
        while (idxB === idxA) idxB = Math.floor(Math.random() * pool.length);
        this.currentMatch = { a: pool[idxA], b: pool[idxB] };

        arena.innerHTML = `<div class="battle-card" id="movie-a"></div><div class="vs">נגד</div><div class="battle-card" id="movie-b"></div>`;
        this.renderBattleCard('movie-a', this.currentMatch.a);
        this.renderBattleCard('movie-b', this.currentMatch.b);
    }

    renderBattleCard(id, movie) {
        const c = document.getElementById(id);
        const url = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750';
        c.innerHTML = `<img src="${url}"> <div class="info"><h3>${movie.hebrew_title || movie.title}</h3><small>${movie.title}</small></div>`;
        c.onclick = () => {
            const out = (movie.id === this.currentMatch.a.id) ? 1 : 0;
            this.updateElo(this.currentMatch.a.id, this.currentMatch.b.id, out);
            this.saveToLocalStorage(); this.renderBattle();
        };
    }

    updateElo(idA, idB, outcome) {
        const Ra = this.eloScores[idA] || 1000, Rb = this.eloScores[idB] || 1000, K = 32;
        const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400)), Eb = 1 / (1 + Math.pow(10, (Ra - Rb) / 400));
        this.eloScores[idA] = Math.round(Ra + K * (outcome - Ea));
        this.eloScores[idB] = Math.round(Rb + (K * ((1 - outcome) - Eb)));
    }

    // --- Stats & Watchlist ---
    renderStats() {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        [...this.seenMovies].sort((a,b) => (this.eloScores[b.id]||1000) - (this.eloScores[a.id]||1000)).forEach((m, i) => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${i+1}</td><td><img src="${url}" class="mini-poster"></td><td><strong>${m.hebrew_title}</strong><br><small>${m.title}</small></td><td><span class="rank-badge">${this.eloScores[m.id]}</span></td>`;
            tbody.appendChild(tr);
        });
    }

    renderWatchlist() {
        const tbody = document.getElementById('watchlist-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        this.allMovies.filter(m => this.watchlist.includes(m.id)).forEach(m => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><img src="${url}" class="mini-poster"></td><td><strong>${m.hebrew_title}</strong><br><small>${m.title}</small></td><td><button class="btn-danger btn-sm" onclick="window.removeWatchlist(${m.id})">הסר</button></td>`;
            tbody.appendChild(tr);
        });
    }

    registerGlobals() {
        window.removeWatchlist = (id) => { this.watchlist = this.watchlist.filter(wid => wid !== id); this.saveToLocalStorage(); this.renderWatchlist(); };
    }

    setupGeneralEvents() {
        this.registerGlobals();
        
        // Copy formatted text for Gemini
        const copyBtn = document.getElementById('copy-stats');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const sorted = [...this.seenMovies].sort((a,b) => (this.eloScores[b.id]||1000) - (this.eloScores[a.id]||1000));
                if (sorted.length === 0) {
                    this.showToast('אין עדיין סרטים מדורגים להעתקה!');
                    return;
                }
                
                let text = "--- דירוג הסרטים שלי ב-KenLo ---\n\n";
                sorted.forEach((m, i) => {
                    const score = this.eloScores[m.id] || 1000;
                    text += `${i+1}. ${m.hebrew_title || m.title} (${Math.round(score)} Elo)\n`;
                });
                
                if (this.watchlist.length > 0) {
                    text = text.trim() + "\n\n--- רשימת צפייה ---\n";
                    this.allMovies.filter(m => this.watchlist.includes(m.id)).forEach(m => {
                        text += `- ${m.hebrew_title || m.title}\n`;
                    });
                }

                navigator.clipboard.writeText(text).then(() => {
                    this.showToast('הרשימה הועתקה! עכשיו אפשר להדביק ב-Gemini');
                }).catch(err => {
                    this.showToast('שגיאה בהעתקה. נחוץ חיבור מאובטח (HTTPS)');
                });
            };
        }

        document.getElementById('export-data').onclick = () => {
            const blob = new Blob([JSON.stringify({
                seen: this.seenMovies.map(m => ({title: m.title, score: this.eloScores[m.id]})),
                watchlist: this.allMovies.filter(m => this.watchlist.includes(m.id)).map(m => m.title),
                genres: GENRES
            }, null, 2)], {type:'application/json'});
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kenlo_backup.json'; a.click();
        };
        
        document.getElementById('reset-app').onclick = () => { 
            if (confirm('בטוח שתרצה למחוק את כל הדירוגים והנתונים? הפעולה לא ניתנת לביטול.')) { 
                localStorage.removeItem('movieRankerData'); 
                location.reload(); 
            } 
        };
    }

    showToast(msg) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 3500);
    }
}

window.addEventListener('DOMContentLoaded', () => { new MovieRanker(); });
