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
        this.contentType = 'movie'; // 'movie' or 'tv'
        this.movieData = {
            all: [],
            seen: [],
            notSeen: {},
            watchlist: [],
            history: [],
            elo: {},
            stats: {}, // { id: { wins: 0, total: 0 } }
            pages: { 'movie/popular':0, 'movie/top_rated':0, 'discover/movie':0, 'movie/now_playing':0 },
            tournament: null
        };
        this.tvData = {
            all: [],
            seen: [],
            notSeen: {},
            watchlist: [],
            history: [],
            elo: {},
            stats: {}, // { id: { wins: 0, total: 0 } }
            pages: { 'tv/popular':0, 'tv/top_rated':0, 'discover/tv':0, 'tv/on_the_air':0, 'tv/israeli':0 },
            tournament: null
        };

        this.currentView = 'swipe';
        this.tmdbKey = 'ec87e3d1438c3e8193530d6b09b21c26';
        this.currentMatch = null;
        
        // UI State
        this.selectedSwipeGenre = 'all';
        this.selectedBattleGenre = 'all';
        this.searchTimeout = null;
        this.RECURRENCE_DELAY = 1000 * 60 * 60 * 24 * 30; // 30 days
        this.SWIPE_UP_THRESHOLD = -200; // Harder to swipe up
        this.isFetching = false;
        
        this.cardStack = document.getElementById('card-stack');
        this.views = document.querySelectorAll('.view');
        this.navLinks = document.querySelectorAll('.nav-links li');
        this.userName = localStorage.getItem('kenlo_user_name') || '';
        this.battleMode = localStorage.getItem('kenlo_battle_mode') || 'dual';
        this.init();
    }

    updateHeaderName() {
        const logo = document.querySelector('.logo');
        if (logo) {
            logo.innerHTML = `Cut<span>!</span>`;
        }
    }

    // Shortcut to current mode's data
    get data() { return this.contentType === 'movie' ? this.movieData : this.tvData; }
    
    getTerm(type = 'singular') {
        if (this.contentType === 'movie') {
            return type === 'singular' ? 'סרט' : 'סרטים';
        } else {
            return type === 'singular' ? 'סדרה' : 'סדרות';
        }
    }

    async init() {
        this.loadFromLocalStorage();
        this.setupNavigation();
        this.setupSwipeEvents();
        this.setupSearchEvents();
        this.setupGeneralEvents();
        this.updateTheme();
        this.updateHeaderName();
        this.setupModeToggle();
        this.renderGenreSelectors();
        this.setupTournamentEvents();
        this.setupMatchmakerEvents();
        this.setupStatsSubNavEvents();
        this.renderCurrentView();
        
        if (this.tmdbKey) {
            await this.fetchContentMixed();
        }
    }

    // --- Data Management ---
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    async fetchContentMixed(batchSize = 3) {
        if (!this.tmdbKey || this.isFetching) return;
        this.isFetching = true;
        const fetchType = this.contentType; // Lock type for this async run
        
        try {
            const endpoints = fetchType === 'movie' 
                ? [ 'movie/popular', 'movie/top_rated', 'discover/movie', 'movie/now_playing' ]
                : [ 'tv/popular', 'tv/top_rated', 'discover/tv', 'tv/on_the_air', 'tv/israeli' ];

            for (const endpoint of endpoints) {
                for (let i = 0; i < batchSize; i++) {
                    const targetData = fetchType === 'movie' ? this.movieData : this.tvData;
                    const pages = targetData.pages;
                    pages[endpoint] = (pages[endpoint] || 0) + 1;
                    let page = pages[endpoint];
                    if (page > 15) page = Math.floor(Math.random() * 10) + 1; // Stay on top pages!
                    
                    let extraParams = '';
                    let usePage = page;
                    
                    if (endpoint.includes('discover')) {
                        extraParams = '&sort_by=popularity.desc&vote_count.gte=300';
                        usePage = Math.floor(Math.random() * 10) + 1;
                    } else if (endpoint === 'tv/israeli') {
                        const ilPage = Math.floor(Math.random() * 3) + 1;
                        const urlIL = `https://api.themoviedb.org/3/discover/tv?api_key=${this.tmdbKey}&language=he-IL&with_origin_country=IL&page=${ilPage}&sort_by=popularity.desc`;
                        await this.fetchAndAdd(urlIL, fetchType);
                        continue;
                    }
                    
                    const baseEndpoint = endpoint === 'tv/israeli' ? 'discover/tv' : endpoint;
                    const url = `https://api.themoviedb.org/3/${baseEndpoint}?api_key=${this.tmdbKey}&language=he-IL&page=${usePage}${extraParams}`;
                    await this.fetchAndAdd(url, fetchType);
                }
            }
            
            // Sort pool primarily by popularity and quality so mainstream hits appear first
            this.data.all.sort((a, b) => {
                const scoreA = (a.popularity || 10) * Math.log10(Math.max(a.vote_count || 10, 10));
                const scoreB = (b.popularity || 10) * Math.log10(Math.max(b.vote_count || 10, 10));
                return scoreB - scoreA;
            });
            
            this.renderCurrentView();
        } catch (e) { console.error("Fetch failed:", e); } finally { this.isFetching = false; }
    }

    async fetchAndAdd(url, targetType) {
        const res = await fetch(url);
        const data = await res.json();
        if (data.results) {
            data.results.forEach(item => {
                if (item.genre_ids && item.genre_ids.includes(16)) return;
                
                const voteCount = item.vote_count || 0;
                const pop = item.popularity || 0;
                const releaseYear = item.release_date ? parseInt(item.release_date.split('-')[0]) : 
                                    (item.first_air_date ? parseInt(item.first_air_date.split('-')[0]) : 2020);
                
                // Filter out low vote & low popularity obscure films
                if (voteCount < 200 && pop < 8.0) return;
                
                // Filter out obscure old movies (< 1975 unless high vote count)
                if (releaseYear < 1975 && voteCount < 1200) return;
                
                const isEnglishOrHebrew = item.original_language === 'en' || item.original_language === 'he';
                const isIsraeli = targetType === 'tv' && item.origin_country && item.origin_country.includes('IL');
                const isGlobalHit = voteCount >= 500 && item.vote_average >= 7.0;
                const isWeirdAsian = ['hi', 'ja', 'ko', 'zh', 'ta', 'te', 'ml', 'th', 'tr'].includes(item.original_language);
                
                if (isWeirdAsian && !isGlobalHit) return;
                if (item.original_language === 'tr' && targetType === 'tv' && voteCount < 200) return;
                
                if (isEnglishOrHebrew || isIsraeli || isGlobalHit) {
                    if (item.poster_path && (item.title || item.name)) {
                        this.addMovieToPool({
                            id: item.id,
                            title: item.original_title || item.original_name,
                            hebrew_title: item.title || item.name,
                            poster_path: item.poster_path,
                            genre_ids: item.genre_ids,
                            release_date: item.release_date || item.first_air_date,
                            vote_average: item.vote_average,
                            vote_count: voteCount,
                            popularity: pop
                        }, targetType);
                    }
                }
            });
        }
    }

    addMovieToPool(item, targetType) {
        const targetData = targetType === 'movie' ? this.movieData : this.tvData;
        if (!targetData.all.find(m => m.id === item.id)) {
            targetData.all.push(item);
            if (!targetData.elo[item.id]) targetData.elo[item.id] = 1000;
        }
    }

    loadFromLocalStorage() {
        let saved = localStorage.getItem('kenlo_data_v2');
        
        if (!saved) {
            const legacy = localStorage.getItem('kenlo_data');
            if (legacy) {
                try {
                    const old = JSON.parse(legacy);
                    // Format correctly into movieData wrapper!
                    this.movieData = { ...this.movieData, all: old.all || [], seen: old.seen || [], notSeen: old.notSeen || {}, elo: old.elo || {} };
                } catch(e) {}
                localStorage.removeItem('kenlo_data');
                this.saveToLocalStorage(); // Solidify the migration immediately
                saved = localStorage.getItem('kenlo_data_v2');
            }
        }
        
        if (saved) {
            const parsed = JSON.parse(saved);
            this.movieData = parsed.movieData || this.movieData;
            this.tvData = parsed.tvData || this.tvData;
            
            // Clean up the mixed queues from previous race condition bug
            if (!this.movieData.v3_migration_flush) {
                this.movieData.all = [];
                this.tvData.all = [];
                this.movieData.v3_migration_flush = true;
                this.saveToLocalStorage();
            }
            
            // Ensure newly added schema fields exist in loaded data
            if (!this.movieData.stats) this.movieData.stats = {};
            if (!this.tvData.stats) this.tvData.stats = {};
            if (!this.movieData.tournament) this.movieData.tournament = null;
            if (!this.tvData.tournament) this.tvData.tournament = null;
            
            this.renderCurrentView();
        } else {
            this.contentType = 'movie';
            
            // Sync toggle UI
            const radio = document.getElementById(`mode-${this.contentType}`);
            if (radio) radio.checked = true;
            this.updateTheme();
        }
    }

    saveToLocalStorage() {
        const data = {
            movieData: this.movieData,
            tvData: this.tvData,
            lastMode: this.contentType
        };
        localStorage.setItem('kenlo_data_v2', JSON.stringify(data));
        this.updateCounts();
    }

    updateCounts() {
        const seenSpan = document.getElementById('seen-count');
        const battleInfo = document.getElementById('battle-stats-info');
        if (seenSpan) seenSpan.textContent = this.data.seen.length;
        if (battleInfo) battleInfo.innerHTML = `סימנת <span id="seen-count">${this.data.seen.length}</span> ${this.getTerm('plural')} עד כה`;
    }

    // --- Navigation & UI ---
    setupNavigation() {
        this.navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const targetView = link.getAttribute('data-view');
                if (targetView) this.switchView(targetView);
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
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    setupModeToggle() {
        const radios = document.getElementsByName('content-type');
        radios.forEach(radio => {
            radio.onchange = (e) => {
                this.contentType = e.target.value;
                this.updateTheme();
                this.saveToLocalStorage();
                this.renderCurrentView();
                if (this.data.all.length < 50) {
                    this.fetchContentMixed();
                }
            };
        });
    }

    updateTheme() {
        const container = document.querySelector('.app-container');
        if (this.contentType === 'tv') container.classList.add('mode-tv');
        else container.classList.remove('mode-tv');
        
        const h1 = document.querySelector('#swipe-view h1');
        if (h1) h1.textContent = this.contentType === 'movie' ? 'ראית או לא?' : 'ראית כבר?';
        
        const battleDesc = document.getElementById('battle-desc');
        if (battleDesc) battleDesc.textContent = this.contentType === 'movie' ? 'בחר את הסרט המועדף עליך מבין השניים' : 'בחר את הסדרה המועדפת עליך מבין השתיים';

        const searchInput = document.getElementById('movie-search');
        if (searchInput) searchInput.placeholder = this.contentType === 'movie' ? 'חפש סרט להוספה מהירה...' : 'חפש סדרה להוספה מהירה...';
        
        const deleteDesc = document.getElementById('delete-desc');
        if (deleteDesc) deleteDesc.textContent = this.contentType === 'movie' ? 'פעולה זו תמחק את כל הסרטים שסימנת והדירוגים שלהם.' : 'פעולה זו תמחק את כל הסדרות שסימנת והדירוגים שלהן.';

        const movieTh = document.querySelector('.leaderboard th:nth-child(3)');
        if (movieTh) movieTh.textContent = `שם ה${this.getTerm()}`;

        const resetBtn = document.getElementById('reset-app');
        if (resetBtn) resetBtn.textContent = `אפס את כל ה${this.getTerm('plural')}`;
    }

    renderGenreSelectors() {
        const swipeContainer = document.getElementById('swipe-genre-filter');
        if (swipeContainer) swipeContainer.style.display = 'none';
    }

    renderCurrentView() {
        if (this.currentView === 'swipe') this.renderSwipe();
        if (this.currentView === 'battle') {
            const mode = localStorage.getItem('kenlo_battle_mode') || 'dual';
            this.switchBattleMode(mode);
        }
        if (this.currentView === 'stats') this.renderStats();
        if (this.currentView === 'watchlist') this.renderWatchlist();
        this.updateCounts();
    }

    // --- Swipe Logic ---
    renderSwipe() {
        const now = Date.now();
        const filtered = this.data.all.filter(movie => {
            const isSeen = this.data.seen.find(m => m.id === movie.id);
            const historyTime = this.data.notSeen[movie.id];
            const isResting = historyTime && (now - historyTime < this.RECURRENCE_DELAY);
            // No category filter by default anymore since it's hidden
            return !isSeen && !isResting;
        });

        // Trigger background fetch if deck is low
        if (filtered.length < 15 && !this.isFetching) {
            this.fetchContentMixed(4);
        }

        if (filtered.length === 0) {
            this.cardStack.innerHTML = '<div class="stack-placeholder">טוען תוכן נוסף... המתן רגע.</div>';
            return;
        }

        const top3 = filtered.slice(0, 3).reverse();
        const currentIds = top3.map(m => m.id);

        // 1. Remove cards no longer in the top 3 (e.g., swiped ones)
        Array.from(this.cardStack.children).forEach(card => {
            if (card.classList && card.classList.contains('stack-placeholder')) {
                card.remove(); return;
            }
            if (!currentIds.includes(parseInt(card.dataset.id)) || 
                card.classList.contains('card-exit-left') || 
                card.classList.contains('card-exit-right')) {
                card.remove();
            }
        });

        // 2. Add missing cards and configure top draggable
        top3.forEach((movie, index, arr) => {
            const isTop = (index === arr.length - 1);
            let card = Array.from(this.cardStack.children).find(c => parseInt(c.dataset.id) === movie.id);
            
            if (!card) {
                card = this.createMovieCard(movie, isTop);
                this.cardStack.appendChild(card);
            } else {
                // Ensure top card is draggable
                if (isTop && !card.dataset.draggable) {
                    this.makeDraggable(card);
                    card.dataset.draggable = 'true';
                }
            }
            // Explicitly set z-index so the visually top card is strictly the one logically on top
            card.style.zIndex = index + 10;
        });
    }

    createMovieCard(movie, isTop) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.dataset.id = movie.id;
        const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';
        const onWatchlist = this.data.watchlist.includes(movie.id);

        card.innerHTML = `
            ${onWatchlist ? '<div class="watchlist-badge">ברשימת צפייה</div>' : ''}
            <img src="${posterUrl}" alt="${movie.title}" style="object-fit: contain; background-color: #0f172a;">
            <div class="info">
                <h2>${movie.hebrew_title || movie.title}</h2>
                <div class="sub">${movie.title} ${movie.release_date ? '(' + movie.release_date.split('-')[0] + ')' : ''}</div>
            </div>
        `;
        if (isTop) {
            this.makeDraggable(card);
            card.dataset.draggable = 'true';
        }
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
            if (dy < this.SWIPE_UP_THRESHOLD) this.handleWatchlistAction(el);
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
        if (!this.data.watchlist.includes(id)) {
            this.data.watchlist.push(id);
            this.saveToLocalStorage();
            el.classList.add('card-save-watchlist');
            setTimeout(() => { el.classList.remove('card-save-watchlist'); el.style.transform = ''; this.renderSwipe(); }, 500);
        } else {
            el.style.transition = '0.3s'; el.style.transform = '';
        }
    }

    swipe(el, direction) {
        const id = parseInt(el.dataset.id);
        const isLeft = direction === 'left';
        
        // Add exit animation
        el.classList.add(isLeft ? 'card-exit-left' : 'card-exit-right');
        
        // Wait for animation before updating DOM
        setTimeout(() => {
            // Log history for undo
            if (!this.data.history) this.data.history = [];
            this.data.history.push({ id, action: isLeft ? 'left' : 'right' });
            if (this.data.history.length > 50) this.data.history.shift();
            
            if (isLeft) {
                this.data.notSeen[id] = Date.now();
            } else {
                const movie = this.data.all.find(m => m.id == id);
                if (movie && !this.data.seen.find(s => s.id == id)) {
                    this.data.seen.push(movie);
                }
            }
            this.saveToLocalStorage();
            this.renderSwipe();
        }, 300);
    }

    undo() {
        if (!this.data.history || this.data.history.length === 0) {
            this.showToast('אין עוד פעולות לביטול');
            return;
        }
        
        const lastAction = this.data.history.pop();
        const id = lastAction.id;
        
        if (lastAction.action === 'left') {
            delete this.data.notSeen[id];
        } else if (lastAction.action === 'right') {
            this.data.seen = this.data.seen.filter(s => s.id !== id);
        } else if (lastAction.action === 'watchlist') {
            this.data.watchlist = this.data.watchlist.filter(w => w !== id);
        }
        
        // Move to the very top of unseen cards so it comes back instantly
        const movieIndex = this.data.all.findIndex(m => m.id === id);
        if (movieIndex !== -1) {
            const movie = this.data.all.splice(movieIndex, 1)[0];
            this.data.all.unshift(movie);
        }
        
        this.saveToLocalStorage();
        this.renderSwipe();
        this.showToast('הפעולה בוטלה');
    }

    setupSwipeEvents() {
        const getTopCard = () => {
            return Array.from(this.cardStack.children)
                .filter(c => !c.classList.contains('stack-placeholder') && 
                             !c.classList.contains('card-exit-left') && 
                             !c.classList.contains('card-exit-right'))
                .sort((a,b) => parseInt(b.style.zIndex || 0) - parseInt(a.style.zIndex || 0))[0];
        };

        document.getElementById('swipe-no').onclick = () => {
            const top = getTopCard();
            if (top) this.swipe(top, 'left');
        };
        const undoBtn = document.getElementById('swipe-undo');
        if (undoBtn) undoBtn.onclick = () => this.undo();
        document.getElementById('swipe-yes').onclick = () => {
            const top = getTopCard();
            if (top) this.swipe(top, 'right');
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
                const url = `https://api.themoviedb.org/3/search/${this.contentType}?api_key=${this.tmdbKey}&language=he-IL&query=${encodeURIComponent(query)}`;
                const res = await fetch(url);
                const data = await res.json();
                found = data.results || [];
            } catch (e) { console.error(e); }
        }

        const local = this.data.all.filter(m => 
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
                const obj = {
                    id: movie.id,
                    title: movie.title || movie.original_title,
                    hebrew_title: movie.hebrew_title || movie.title || movie.original_title,
                    poster_path: movie.poster_path,
                    genre_ids: movie.genre_ids,
                    release_date: movie.release_date
                };
                
                // Remove from lists if exists
                this.data.all = this.data.all.filter(m => m.id !== obj.id);
                this.data.seen = this.data.seen.filter(m => m.id !== obj.id);
                delete this.data.notSeen[obj.id];
                
                // Add to the VERY TOP of the queue (unshift) 
                this.data.all.unshift(obj);
                
                this.saveToLocalStorage();
                this.showToast(`נוסף לתחילת החפיסה: ${obj.hebrew_title}`);
                
                resultsDiv.style.display = 'none';
                document.getElementById('movie-search').value = '';
                
                // Ensure we switch to swipe view so the user can see it right away   
                document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
                document.querySelector('.nav-item[data-target="swipe"]').classList.add('active');
                this.currentView = 'swipe';
                
                this.renderCurrentView();
            };
            resultsDiv.appendChild(item);
        });
    }

    // --- Battle Logic ---
    renderBattle() {
        const arena = document.getElementById('battle-arena');
        const pool = this.data.seen;

        if (pool.length < 2) {
            arena.innerHTML = `<div class="stack-placeholder">צריך לפחות 2 ${this.getTerm('plural')} שראית ב-"${GENRES[this.selectedBattleGenre] || 'ז\'אנר זה'}" כדי להלחם!</div>`;
            return;
        }

        // Smart Matchmaking: 
        // 1. Pick a random base candidate
        const idxA = Math.floor(Math.random() * pool.length);
        const movieA = pool[idxA];
        
        // 2. Pick a candidate with similar rank OR low battle count
        let poolB = pool.filter(m => m.id !== movieA.id);
        const rankA = this.data.elo[movieA.id] || 1000;
        
        // Prefer "fresher" movies or those close in rank (ELO +/- 200)
        let weightedPoolB = poolB.filter(m => Math.abs((this.data.elo[m.id]||1000) - rankA) < 150);
        
        // If no close matches, fallback to low battle count items
        if (weightedPoolB.length === 0) {
            weightedPoolB = poolB.sort((a,b) => (this.data.stats[a.id]?.total||0) - (this.data.stats[b.id]?.total||0)).slice(0, 10);
        }

        const movieB = weightedPoolB[Math.floor(Math.random() * weightedPoolB.length)] || poolB[0];
        
        this.currentMatch = { a: movieA, b: movieB };

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
        // Init stats if missing
        if (!this.data.stats[idA]) this.data.stats[idA] = { wins: 0, total: 0 };
        if (!this.data.stats[idB]) this.data.stats[idB] = { wins: 0, total: 0 };

        const Ra = this.data.elo[idA] || 1000, Rb = this.data.elo[idB] || 1000, K = 32;
        const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400)), Eb = 1 / (1 + Math.pow(10, (Ra - Rb) / 400));
        
        // Traditional ELO update
        this.data.elo[idA] = Math.round(Ra + K * (outcome - Ea));
        this.data.elo[idB] = Math.round(Rb + (K * ((1 - outcome) - Eb)));
        
        // Win Rate update
        this.data.stats[idA].total++;
        this.data.stats[idB].total++;
        if (outcome === 1) this.data.stats[idA].wins++;
        else this.data.stats[idB].wins++;
    }

    getNormScore(id) {
        // Map 800-1600 ELO range to 1.0-10.0 scale
        const elo = this.data.elo[id] || 1000;
        let score = ((elo - 800) / 80).toFixed(1);
        if (score > 10.0) score = 10.0;
        if (score < 1.0) score = 1.0;
        return score;
    }

    getWinRate(id) {
        const s = this.data.stats[id];
        if (!s || s.total === 0) return 0;
        return Math.round((s.wins / s.total) * 100);
    }

    // --- Tournament Management ---
    setupTournamentEvents() {
        // Mode Switcher
        document.getElementById('mode-dual').onclick = () => this.switchBattleMode('dual');
        document.getElementById('mode-tournament').onclick = () => this.switchBattleMode('tournament');

        // Tournament Size Grid Selection
        document.querySelectorAll('.t-size-card').forEach(card => {
            card.onclick = () => {
                const sizeVal = card.dataset.size;
                const poolSize = this.data.seen.length;
                if (poolSize < 8) {
                    alert('צריך לפחות 8 סרטים שראית כדי להתחיל טורניר!');
                    return;
                }
                
                if (this.data.tournament && !confirm('יש טורניר פעיל. להתחיל חדש ולמחוק את הקיים?')) return;
                
                let targetSize = sizeVal === 'all' ? poolSize : parseInt(sizeVal);
                if (targetSize > poolSize) targetSize = poolSize;
                
                this.initTournament(targetSize);
            };
        });

        // Persistent Nav
        document.querySelectorAll('.t-nav-btn').forEach(btn => {
            btn.onclick = () => {
                const view = btn.dataset.tView;
                this.showTournamentView(view);
            };
        });

        // Reset Tournament
        document.getElementById('reset-t-btn').onclick = () => {
            if (confirm('בטוח שברצונך לאפס את הטורניר הנוכחי? כל ההתקדמות תימחק.')) {
                this.data.tournament = null;
                this.saveToLocalStorage();
                this.renderTournament();
                this.showToast('הטורניר אופס');
            }
        };
    }

    switchBattleMode(mode) {
        this.battleMode = mode;
        localStorage.setItem('kenlo_battle_mode', mode);
        
        const dualContainer = document.getElementById('dual-arena-container');
        const tContainer = document.getElementById('tournament-container');
        const dualBtn = document.getElementById('mode-dual');
        const tBtn = document.getElementById('mode-tournament');

        if (mode === 'dual') {
            dualContainer.style.display = 'block';
            tContainer.style.display = 'none';
            dualBtn.classList.add('active');
            tBtn.classList.remove('active');
            this.renderBattle();
        } else {
            dualContainer.style.display = 'none';
            tContainer.style.display = 'block';
            dualBtn.classList.remove('active');
            tBtn.classList.add('active');
            this.renderTournament();
        }
        if (window.lucide) window.lucide.createIcons();
    }

    showTournamentView(viewName) {
        document.querySelectorAll('.tournament-subview').forEach(v => v.style.display = 'none');
        const target = document.getElementById(`tournament-${viewName}`);
        if (target) target.style.display = 'block';
        
        // Update Nav active state
        document.querySelectorAll('.t-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tView === viewName);
        });

        if (viewName === 'groups') this.renderGroups();
        if (viewName === 'bracket') this.renderBracket();
    }

    initTournament(size) {
        // Seeding: Sort by ELO
        const sortedPool = [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000));
        const participants = sortedPool.slice(0, size);
        
        if (size < 12) {
            // Pure Knockout for small pools (< 12 items)
            const bracketSize = Math.pow(2, Math.floor(Math.log2(size)));
            const finalParticipants = participants.slice(0, bracketSize);
            const rounds = this.createEmptyBracket(bracketSize);
            
            // Seed first round
            this.shuffleArray(finalParticipants);
            rounds[0].matches.forEach((m, idx) => {
                m.a = finalParticipants[idx*2].id;
                m.b = finalParticipants[idx*2+1].id;
            });

            this.data.tournament = {
                status: 'bracket',
                participants: finalParticipants,
                groups: [],
                bracket: rounds,
                playedCount: 0,
                totalMatches: rounds.reduce((acc, r) => acc + r.matches.length, 0)
            };
        } else {
            // World Cup / Champions League Format: Groups of 4! (6 matches per group)
            const groupsCount = Math.floor(size / 4); 
            const groups = [];
            for (let i = 0; i < groupsCount; i++) {
                groups.push({
                    name: String.fromCharCode(65 + i),
                    members: [],
                    matches: [],
                    results: {}
                });
            }

            // Distribute participants into 4 Pots (Seed-based)
            const itemsPerGroup = 4;
            for (let potIdx = 0; potIdx < itemsPerGroup; potIdx++) {
                const pot = participants.slice(potIdx * groupsCount, (potIdx + 1) * groupsCount);
                this.shuffleArray(pot);
                pot.forEach((p, gIdx) => {
                    if (groups[gIdx]) {
                        groups[gIdx].members.push({
                            id: p.id,
                            name: p.hebrew_title || p.title,
                            poster: p.poster_path,
                            points: 0,
                            played: 0,
                            wins: 0,
                            draws: 0,
                            losses: 0
                        });
                    }
                });
            }

            // Generate matches for each group (Round Robin: 6 matches per group of 4)
            // (0,1), (2,3), (0,2), (1,3), (0,3), (1,2)
            const pairOrder = [ [0,1], [2,3], [0,2], [1,3], [0,3], [1,2] ];
            groups.forEach(group => {
                pairOrder.forEach(([i, j]) => {
                    if (group.members[i] && group.members[j]) {
                        group.matches.push({
                            id: `${group.name}-${i}-${j}`,
                            a: group.members[i].id,
                            b: group.members[j].id,
                            winner: null
                        });
                    }
                });
            });

            // Interleave matches across groups by round so no team plays back-to-back!
            const schedule = [];
            for (let matchIdx = 0; matchIdx < 6; matchIdx++) {
                for (let gIdx = 0; gIdx < groupsCount; gIdx++) {
                    if (groups[gIdx].matches[matchIdx]) {
                        schedule.push({ groupIdx: gIdx, match: groups[gIdx].matches[matchIdx] });
                    }
                }
            }

            this.data.tournament = {
                status: 'groups',
                participants: participants,
                groups: groups,
                schedule: schedule,
                scheduleIndex: 0,
                bracket: null,
                playedCount: 0,
                totalMatches: schedule.length
            };
        }

        this.saveToLocalStorage();
        this.renderTournament();
        this.showToast(`טורניר ${participants.length} ${this.getTerm('plural')} יצא לדרך!`);
    }

    createEmptyBracket(size) {
        const rounds = [];
        let currentSize = size;
        while (currentSize >= 2) {
            const matchesCount = currentSize / 2;
            let roundName = '';
            if (currentSize === 2) roundName = 'גמר';
            else if (currentSize === 4) roundName = 'חצי גמר';
            else if (currentSize === 8) roundName = 'רבע גמר';
            else if (currentSize === 16) roundName = 'שמינית גמר';
            else roundName = `שלב ${currentSize}`;

            const round = { name: roundName, matches: [] };
            for (let i = 0; i < matchesCount; i++) {
                round.matches.push({ a: null, b: null, winner: null });
            }
            rounds.push(round);
            currentSize /= 2;
        }
        return rounds;
    }

    renderTournament() {
        const tNav = document.getElementById('t-nav');
        const descAll = document.getElementById('t-all-count-desc');
        if (descAll) descAll.textContent = `טורניר אליפות מלא על כל ה-${this.data.seen.length} שראית`;

        if (!this.data.tournament) {
            this.showTournamentView('dashboard');
            document.getElementById('t-current-stage').textContent = 'ממתין';
            document.getElementById('t-played-count').textContent = '0';
            if (tNav) tNav.style.display = 'none';
            return;
        }

        const t = this.data.tournament;
        document.getElementById('t-played-count').textContent = `${t.playedCount} / ${t.totalMatches || '?'}`;
        if (tNav) tNav.style.display = 'flex';
        
        if (t.status === 'groups') {
            document.getElementById('t-current-stage').textContent = 'בתים';
            
            let nextMatchObj = null;
            let groupIdx = -1;

            if (t.schedule && t.scheduleIndex < t.schedule.length) {
                const item = t.schedule.find(s => s.match.winner === null);
                if (item) {
                    nextMatchObj = item.match;
                    groupIdx = item.groupIdx;
                }
            } else {
                // Fallback scan
                for (let i = 0; i < t.groups.length; i++) {
                    const match = t.groups[i].matches.find(m => m.winner === null);
                    if (match) {
                        nextMatchObj = match;
                        groupIdx = i;
                        break;
                    }
                }
            }

            if (nextMatchObj) {
                const group = t.groups[groupIdx];
                document.getElementById('t-match-label').textContent = `שלב הבתים - בית ${group.name}`;
                this.renderTournamentMatch(nextMatchObj, 'groups', groupIdx);
            } else {
                this.showToast('שלב הבתים הסתיים! עוברים לנוקאאוט...');
                this.generateKnockoutStage();
            }
        } else if (t.status === 'bracket') {
            document.getElementById('t-current-stage').textContent = 'נוקאאוט';
            
            let nextMatch = null;
            let roundIdx = -1;
            for (let i = 0; i < t.bracket.length; i++) {
                const match = t.bracket[i].matches.find(m => m.winner === null && m.a && m.b);
                if (match) {
                    nextMatch = match;
                    roundIdx = i;
                    break;
                }
            }

            if (nextMatch) {
                const round = t.bracket[roundIdx];
                document.getElementById('t-match-label').textContent = `שלב הנוקאאוט - ${round.name}`;
                this.renderTournamentMatch(nextMatch, 'bracket', roundIdx);
            } else {
                const lastRound = t.bracket[t.bracket.length - 1];
                const finalMatch = lastRound.matches[0];
                if (finalMatch && finalMatch.winner) {
                    this.renderTournamentWinner(finalMatch.winner);
                } else {
                    this.showTournamentView('bracket');
                }
            }
        } else if (t.status === 'finished') {
             document.getElementById('t-current-stage').textContent = 'הסתיים';
             this.renderTournamentWinner(t.winnerId);
        }
    }

    renderTournamentMatch(match, stage, stageIdx) {
        this.showTournamentView('match');
        const arena = document.getElementById('t-battle-arena');
        const movieA = this.data.seen.find(m => m.id === match.a);
        const movieB = this.data.seen.find(m => m.id === match.b);

        if (!movieA || !movieB) {
            console.error("Match movies not found", match);
            return;
        }

        arena.innerHTML = `<div class="battle-card" id="t-movie-a"></div><div class="vs">נגד</div><div class="battle-card" id="t-movie-b"></div>`;
        
        const renderCard = (id, movie, otherId) => {
            const c = document.getElementById(id);
            const url = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750';
            c.innerHTML = `<img src="${url}"> <div class="info"><h3>${movie.hebrew_title || movie.title}</h3><small>${movie.title}</small></div>`;
            
            c.onclick = () => {
                // Interactive match selection feedback animation
                c.classList.add('t-match-winner-glow');
                const other = document.getElementById(otherId);
                if (other) other.classList.add('t-match-loser-fade');

                setTimeout(() => {
                    this.handleTournamentWinner(movie.id, match, stage, stageIdx);
                }, 350);
            };
        };

        renderCard('t-movie-a', movieA, 't-movie-b');
        renderCard('t-movie-b', movieB, 't-movie-a');
    }

    handleTournamentWinner(winnerId, match, stage, stageIdx) {
        const t = this.data.tournament;
        match.winner = winnerId;
        t.playedCount++;

        // 1. Update regular ELO for tournament impact
        const loserId = (winnerId === match.a) ? match.b : match.a;
        const outcome = (winnerId === match.a) ? 1 : 0;
        this.updateElo(match.a, match.b, outcome);

        if (stage === 'groups') {
            const group = t.groups[stageIdx];
            const m1 = group.members.find(m => m.id === match.a);
            const m2 = group.members.find(m => m.id === match.b);
            
            m1.played++; m2.played++;
            if (winnerId === m1.id) {
                m1.points += 3; m1.wins++; m2.losses++;
            } else {
                m2.points += 3; m2.wins++; m1.losses++;
            }
            // Sort group members by points, then ELO
            group.members.sort((a,b) => b.points - a.points || (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000));
        } else {
            // Bracket: Advance winner to next round
            const currentRoundIdx = stageIdx;
            if (currentRoundIdx < t.bracket.length - 1) {
                const nextRound = t.bracket[currentRoundIdx + 1];
                const matchInRoundIdx = t.bracket[currentRoundIdx].matches.indexOf(match);
                const nextMatchIdx = Math.floor(matchInRoundIdx / 2);
                const nextMatch = nextRound.matches[nextMatchIdx];
                if (matchInRoundIdx % 2 === 0) nextMatch.a = winnerId;
                else nextMatch.b = winnerId;
            } else {
                // Final!
                t.status = 'finished';
                t.winnerId = winnerId;
                
                // Winner's Grand Champion Bonus (+100 ELO)
                if (!this.data.elo[winnerId]) this.data.elo[winnerId] = 1000;
                this.data.elo[winnerId] += 100;
                this.showToast('🏆 בונוס אלוף הוענק!');
            }
        }

        this.saveToLocalStorage();
        this.renderTournament();
    }

    renderGroups() {
        const grid = document.getElementById('groups-grid');
        grid.innerHTML = '';
        const t = this.data.tournament;
        if (!t || !t.groups) return;

        t.groups.forEach(g => {
            const table = document.createElement('div');
            const isFinished = !g.matches.find(m => m.winner === null);
            table.className = `group-table ${isFinished ? 'finished' : ''}`;
            
            let rowsHtml = `<div class="group-row group-header"><span class="m-name">סרט</span><span>מש'</span><span>נק'</span><span>ELO</span></div>`;
            g.members.forEach((m, idx) => {
                let winClass = '';
                if (idx === 0) winClass = isFinished ? 'winner' : 'leading';
                else if (idx === 1) winClass = isFinished ? 'runner-up' : 'qualifying';
                
                rowsHtml += `
                    <div class="group-row ${winClass}">
                        <span class="m-name">${m.name}</span>
                        <span>${m.played}</span>
                        <span><strong>${m.points}</strong></span>
                        <span><small>${this.data.elo[m.id]||1000}</small></span>
                    </div>
                `;
            });
            table.innerHTML = `<h4>בית ${g.name} ${isFinished ? '✅' : ''}</h4>${rowsHtml}`;
            grid.appendChild(table);
        });
    }

    generateKnockoutStage() {
        const t = this.data.tournament;
        const winners = [];
        t.groups.forEach(g => {
            if (g.members[0]) winners.push(g.members[0].id); // 1st place
            if (g.members[1]) winners.push(g.members[1].id); // 2nd place
        });

        // Ensure power of 2 for bracket size (8, 16, 32)
        let bracketSize = Math.pow(2, Math.floor(Math.log2(winners.length)));
        if (bracketSize < 2) bracketSize = 2;
        const bracketWinners = winners.slice(0, bracketSize);

        const rounds = this.createEmptyBracket(bracketWinners.length);

        // Seed first round: 1st place vs 2nd place
        const groupFirsts = t.groups.map(g => g.members[0] ? g.members[0].id : null).filter(Boolean);
        const groupSeconds = t.groups.map(g => g.members[1] ? g.members[1].id : null).filter(Boolean);
        this.shuffleArray(groupSeconds);

        rounds[0].matches.forEach((m, idx) => {
            m.a = groupFirsts[idx] || bracketWinners[idx*2] || null;
            m.b = groupSeconds[idx] || bracketWinners[idx*2+1] || null;
        });

        t.bracket = rounds;
        t.status = 'bracket';
        t.totalMatches += rounds.reduce((acc, r) => acc + r.matches.length, 0);
        this.saveToLocalStorage();
        this.renderTournament();
        this.showTournamentView('bracket');
    }

    renderBracket() {
        const view = document.getElementById('bracket-view');
        view.innerHTML = '';
        const t = this.data.tournament;
        if (!t || !t.bracket) {
            view.innerHTML = '<div class="stack-placeholder">עץ הטורניר ייחשף עם סיום שלב הבתים!</div>';
            return;
        }

        const mapTitle = document.createElement('div');
        mapTitle.className = 'bracket-map-header';
        mapTitle.innerHTML = `<h3>🗺️ מפת עץ הטורניר (מסלול האליפות)</h3>`;
        view.appendChild(mapTitle);

        const treeGrid = document.createElement('div');
        treeGrid.className = 'bracket-tree-map';

        t.bracket.forEach((round, rIdx) => {
            const container = document.createElement('div');
            container.className = `round-column round-stage-${rIdx}`;
            container.innerHTML = `<div class="round-header-badge">${round.name}</div>`;
            
            round.matches.forEach((m, mIdx) => {
                const teamA = this.data.seen.find(mov => mov.id === m.a);
                const teamB = this.data.seen.find(mov => mov.id === m.b);
                const isFinal = (rIdx === t.bracket.length - 1);
                
                const box = document.createElement('div');
                box.className = `match-card-node ${isFinal ? 'final-match-node' : ''}`;
                box.innerHTML = `
                    <div class="node-team ${m.winner && m.winner === m.a ? 'is-winner' : ''}">
                        <img src="${teamA ? 'https://image.tmdb.org/t/p/w92'+teamA.poster_path : 'https://via.placeholder.com/30x45'}">
                        <span class="team-title">${teamA ? (teamA.hebrew_title || teamA.title) : '???'}</span>
                        ${m.winner && m.winner === m.a ? '<span class="crown-tag">👑</span>' : ''}
                    </div>
                    <div class="node-vs">VS</div>
                    <div class="node-team ${m.winner && m.winner === m.b ? 'is-winner' : ''}">
                        <img src="${teamB ? 'https://image.tmdb.org/t/p/w92'+teamB.poster_path : 'https://via.placeholder.com/30x45'}">
                        <span class="team-title">${teamB ? (teamB.hebrew_title || teamB.title) : '???'}</span>
                        ${m.winner && m.winner === m.b ? '<span class="crown-tag">👑</span>' : ''}
                    </div>
                `;
                container.appendChild(box);
            });
            treeGrid.appendChild(container);
        });

        view.appendChild(treeGrid);
    }

    renderTournamentWinner(id) {
        const movie = this.data.seen.find(m => m.id === id);
        this.showTournamentView('dashboard');
        const dash = document.getElementById('tournament-dashboard');
        
        // Find runner-up (2nd place in final match)
        let runnerUpMovie = null;
        if (this.data.tournament && this.data.tournament.bracket) {
            const finalRound = this.data.tournament.bracket[this.data.tournament.bracket.length - 1];
            if (finalRound && finalRound.matches[0]) {
                const fm = finalRound.matches[0];
                const runnerId = (fm.winner === fm.a) ? fm.b : fm.a;
                runnerUpMovie = this.data.seen.find(m => m.id === runnerId);
            }
        }

        const winnerEl = document.createElement('div');
        winnerEl.className = 'winner-announcement';
        winnerEl.style.marginTop = '20px';
        winnerEl.style.textAlign = 'center';
        winnerEl.style.padding = '25px 20px';
        winnerEl.style.background = 'linear-gradient(135deg, rgba(241, 196, 15, 0.2), rgba(15, 23, 42, 0.8))';
        winnerEl.style.borderRadius = '24px';
        winnerEl.style.border = '2px solid #f1c40f';
        winnerEl.style.boxShadow = '0 10px 30px rgba(241, 196, 15, 0.3)';
        
        winnerEl.innerHTML = `
            <div style="font-size: 2.2rem; margin-bottom: 5px;">🏆 אלוף הטורניר! 🏆</div>
            <p style="color: #f1c40f; font-weight: 700; margin-bottom: 15px;">הגביר על כולם והגיע לראש הפיסגה!</p>
            <img src="https://image.tmdb.org/t/p/w500${movie ? movie.poster_path : ''}" style="width: 160px; border-radius: 14px; margin-bottom: 15px; box-shadow: 0 8px 25px rgba(0,0,0,0.5);">
            <h2 style="font-size: 1.6rem; color: #fff; margin-bottom: 15px;">${movie ? (movie.hebrew_title || movie.title) : 'מנצח'}</h2>
            
            ${runnerUpMovie ? `
                <div class="podium-runner-up" style="margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 12px; display: inline-flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.2rem;">🥈 סגן אלוף:</span>
                    <strong>${runnerUpMovie.hebrew_title || runnerUpMovie.title}</strong>
                </div>
            ` : ''}

            <div style="margin-top: 20px;">
                <button class="btn-primary btn-block" id="new-t-after-win-btn">התחל טורניר חדש 🚀</button>
            </div>
        `;
        
        const existing = dash.querySelector('.winner-announcement');
        if (existing) existing.remove();
        
        dash.appendChild(winnerEl);

        const newBtn = document.getElementById('new-t-after-win-btn');
        if (newBtn) {
            newBtn.onclick = () => {
                this.data.tournament = null;
                this.saveToLocalStorage();
                this.renderTournament();
            };
        }
    }

    // --- Stats & Watchlist ---
    // --- Stats Sub Nav & Deep Analytics ---
    setupStatsSubNavEvents() {
        document.querySelectorAll('.stats-tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.stats-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const tab = btn.dataset.statsTab;
                document.querySelectorAll('.stats-tab-content').forEach(c => c.style.display = 'none');
                
                const target = document.getElementById(`stats-tab-${tab}`);
                if (target) target.style.display = 'block';
                
                if (tab === 'analytics') this.renderDeepAnalytics();
                if (tab === 'hall') this.renderHallOfFame();
            };
        });
    }

    renderStats() {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000)).forEach((m, i) => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            const score = this.getNormScore(m.id);
            const winRate = this.getWinRate(m.id);
            tr.innerHTML = `
                <td>${i+1}</td>
                <td><img src="${url}" class="mini-poster"></td>
                <td>
                    <strong>${m.hebrew_title}</strong><br>
                    <small>${winRate}% אהדה · ${this.data.stats[m.id]?.total || 0} קרבות</small>
                </td>
                <td><span class="rank-badge">${score}</span></td>
                <td>
                    <button class="list-btn btn-remove" onclick="window.removeSeen(${m.id})" title="הסר מהרשימה">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>`;
            tbody.appendChild(tr);
        });
        if (window.lucide) window.lucide.createIcons();
    }

    renderDeepAnalytics() {
        const container = document.getElementById('analytics-dashboard-container');
        if (!container) return;
        
        const seen = this.data.seen;
        if (seen.length === 0) {
            container.innerHTML = '<div class="stack-placeholder">סמן סרטים שראית כדי לפתוח את מעבדת הניתוח העמוקה!</div>';
            return;
        }

        // 1. Total Watch Time & General Stats
        const totalMinutes = seen.reduce((acc, m) => acc + (m.runtime || 110), 0);
        const totalHours = Math.round(totalMinutes / 60);
        const totalDays = (totalHours / 24).toFixed(1);
        const avgMinutes = Math.round(totalMinutes / seen.length);
        const totalBattles = Object.values(this.data.stats).reduce((acc, s) => acc + (s.total || 0), 0);

        // 2. Decades Distribution
        const decades = { '70s': 0, '80s': 0, '90s': 0, '2000s': 0, '2010s': 0, '2020s': 0 };
        seen.forEach(m => {
            const yr = m.release_date ? parseInt(m.release_date.split('-')[0]) : 2020;
            if (yr < 1980) decades['70s']++;
            else if (yr < 1990) decades['80s']++;
            else if (yr < 2000) decades['90s']++;
            else if (yr < 2010) decades['2000s']++;
            else if (yr < 2020) decades['2010s']++;
            else decades['2020s']++;
        });

        // 3. Top Genres by ELO
        const genreElos = {};
        seen.forEach(m => {
            if (m.genre_ids) {
                m.genre_ids.forEach(gId => {
                    if (!genreElos[gId]) genreElos[gId] = { sum: 0, count: 0 };
                    genreElos[gId].sum += (this.data.elo[m.id] || 1000);
                    genreElos[gId].count++;
                });
            }
        });
        const genreStats = Object.entries(genreElos)
            .map(([gId, d]) => ({ name: GENRES[gId] || 'כללי', avgElo: Math.round(d.sum / d.count), count: d.count }))
            .sort((a, b) => b.avgElo - a.avgElo)
            .slice(0, 5);

        // 4. Hidden Gems vs. Overrated
        const sortedByElo = [...seen].sort((a, b) => (this.data.elo[b.id] || 1000) - (this.data.elo[a.id] || 1000));
        const top30Percent = sortedByElo.slice(0, Math.ceil(seen.length * 0.35));
        const bottom30Percent = sortedByElo.slice(Math.floor(seen.length * 0.65));

        const hiddenGems = top30Percent.filter(m => (m.vote_average || 7) < 7.4).slice(0, 3);
        const overrated = bottom30Percent.filter(m => (m.vote_average || 7) > 7.6).slice(0, 3);

        container.innerHTML = `
            <div class="analytics-grid">
                <!-- Overview Stats Grid -->
                <div class="stat-card-widget">
                    <div class="widget-icon">⏱️</div>
                    <div class="widget-val">${totalHours} שעות</div>
                    <div class="widget-lbl">סה"כ זמן צפייה (${totalDays} ימים)</div>
                </div>
                <div class="stat-card-widget">
                    <div class="widget-icon">🎬</div>
                    <div class="widget-val">${avgMinutes} דק'</div>
                    <div class="widget-lbl">אורך ${this.getTerm()} ממוצע</div>
                </div>
                <div class="stat-card-widget">
                    <div class="widget-icon">⚔️</div>
                    <div class="widget-val">${totalBattles}</div>
                    <div class="widget-lbl">סה"כ קרבות בדירוג</div>
                </div>

                <!-- Decades Progress Card -->
                <div class="analytics-section-card full-width">
                    <h3>📆 התפלגות לפי עשורים</h3>
                    <div class="decades-list">
                        ${Object.entries(decades).map(([dec, count]) => {
                            const pct = Math.round((count / seen.length) * 100) || 0;
                            const labelMap = { '70s': 'קלאסיקות (<1980)', '80s': 'שנות ה-80', '90s': 'שנות ה-90', '2000s': 'שנות ה-2000', '2010s': 'שנות ה-2010', '2020s': 'שנות ה-2020+' };
                            return `
                                <div class="decade-item">
                                    <div class="decade-lbl"><span>${labelMap[dec]}</span> <span>${count} (${pct}%)</span></div>
                                    <div class="decade-bar-track"><div class="decade-bar-fill" style="width: ${pct}%;"></div></div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Genre ELO Leaderboard -->
                <div class="analytics-section-card full-width">
                    <h3>🎭 הז'אנרים המנצחים בדירוג שלך (ממוצע ELO)</h3>
                    <div class="genre-elo-grid">
                        ${genreStats.map((g, idx) => `
                            <div class="genre-elo-card">
                                <span class="g-rank">#${idx+1}</span>
                                <span class="g-name">${g.name}</span>
                                <span class="g-elo">${g.avgElo} ELO</span>
                                <span class="g-count">${g.count} ${this.getTerm('plural')}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Hidden Gems vs Overrated -->
                <div class="analytics-section-card">
                    <h3>💎 פנינים נסתרות שלי</h3>
                    <p class="section-sub">סרטים שדירגת בטופ, למרות הציון הבינוני בעולם</p>
                    <div class="gems-list">
                        ${hiddenGems.length > 0 ? hiddenGems.map(m => `
                            <div class="mini-movie-row">
                                <img src="${m.poster_path ? 'https://image.tmdb.org/t/p/w92'+m.poster_path : ''}">
                                <div>
                                    <strong>${m.hebrew_title || m.title}</strong>
                                    <small>ציון TMDB: ${m.vote_average || '7.0'} ⭐ · שלך: ${this.getNormScore(m.id)}</small>
                                </div>
                            </div>
                        `).join('') : '<p class="empty-note">עדיין אין פנינים נסתרות מזוהות</p>'}
                    </div>
                </div>

                <div class="analytics-section-card">
                    <h3>🤔 אובר-רייטד לטעמי</h3>
                    <p class="section-sub">סרטים שכל העולם אוהב, אבל אצלך בתחתית</p>
                    <div class="gems-list">
                        ${overrated.length > 0 ? overrated.map(m => `
                            <div class="mini-movie-row">
                                <img src="${m.poster_path ? 'https://image.tmdb.org/t/p/w92'+m.poster_path : ''}">
                                <div>
                                    <strong>${m.hebrew_title || m.title}</strong>
                                    <small>ציון TMDB: ${m.vote_average || '8.0'} ⭐ · שלך: ${this.getNormScore(m.id)}</small>
                                </div>
                            </div>
                        `).join('') : '<p class="empty-note">עדיין אין סרטים מוגדרים כאובר-רייטד</p>'}
                    </div>
                </div>
            </div>
        `;
    }

    renderHallOfFame() {
        const container = document.getElementById('hall-of-fame-container');
        if (!container) return;
        
        const winnerId = this.data.tournament?.winnerId;
        const champion = winnerId ? this.data.seen.find(m => m.id === winnerId) : null;
        
        container.innerHTML = `
            <div class="hall-of-fame-dashboard">
                <div class="hall-champion-banner">
                    <div class="crown-hero">🏆</div>
                    <h2>היכל אלופי הטורנירים</h2>
                    <p>הסרטים והסדרות שהוכרזו כאלוף הבלתי מעורער!</p>
                </div>
                ${champion ? `
                    <div class="current-champ-card">
                        <img src="${champion.poster_path ? 'https://image.tmdb.org/t/p/w500'+champion.poster_path : ''}">
                        <div class="champ-info">
                            <span class="badge-gold">🥇 האלוף הנוכחי</span>
                            <h3>${champion.hebrew_title || champion.title}</h3>
                            <p>זכה בטורניר האחרון וגרף בונוס 100+ ELO!</p>
                        </div>
                    </div>
                ` : `
                    <div class="stack-placeholder">עדיין לא הוכתר אלוף טורניר. שחק בטורניר והכתר את המנצח!</div>
                `}
            </div>
        `;
    }

    // --- Interactive Matchmaker Engine ---
    setupMatchmakerEvents() {
        const modal = document.getElementById('matchmaker-modal');
        const openBtn = document.getElementById('open-matchmaker-btn');
        const closeBtn = document.getElementById('close-matchmaker-btn');
        const prevBtn = document.getElementById('mm-prev-btn');
        const nextBtn = document.getElementById('mm-next-btn');
        const findBtn = document.getElementById('mm-find-btn');
        const restartBtn = document.getElementById('mm-restart-btn');

        if (!modal || !openBtn) return;

        openBtn.onclick = () => {
            modal.style.display = 'flex';
            this.currentMMStep = 1;
            this.showMMStep(1);
        };

        closeBtn.onclick = () => { modal.style.display = 'none'; };
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

        // Option clicks logic
        document.querySelectorAll('.mm-options-grid').forEach(grid => {
            grid.querySelectorAll('.mm-opt-btn').forEach(btn => {
                btn.onclick = () => {
                    grid.querySelectorAll('.mm-opt-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                };
            });
        });

        // Navigation
        prevBtn.onclick = () => {
            if (this.currentMMStep > 1) {
                this.currentMMStep--;
                this.showMMStep(this.currentMMStep);
            }
        };

        nextBtn.onclick = () => {
            if (this.currentMMStep < 5) {
                this.currentMMStep++;
                this.showMMStep(this.currentMMStep);
            }
        };

        findBtn.onclick = () => {
            this.runMatchmakerAlgorithm();
        };

        if (restartBtn) {
            restartBtn.onclick = () => {
                document.getElementById('mm-results-view').style.display = 'none';
                document.getElementById('mm-wizard-steps').style.display = 'block';
                this.currentMMStep = 1;
                this.showMMStep(1);
            };
        }
    }

    showMMStep(stepNum) {
        document.querySelectorAll('.mm-step').forEach(s => s.style.display = 'none');
        const targetStep = document.querySelector(`.mm-step[data-step="${stepNum}"]`);
        if (targetStep) targetStep.style.display = 'block';

        // Update progress dots
        document.querySelectorAll('.mm-progress-dots .dot').forEach((dot, idx) => {
            dot.classList.toggle('active', idx + 1 === stepNum);
        });

        // Buttons state
        const prevBtn = document.getElementById('mm-prev-btn');
        const nextBtn = document.getElementById('mm-next-btn');
        const findBtn = document.getElementById('mm-find-btn');

        if (prevBtn) prevBtn.style.display = stepNum > 1 ? 'inline-block' : 'none';
        if (nextBtn) nextBtn.style.display = stepNum < 5 ? 'inline-block' : 'none';
        if (findBtn) findBtn.style.display = stepNum === 5 ? 'inline-block' : 'none';
    }

    runMatchmakerAlgorithm() {
        const genreVal = document.querySelector('#mm-genre-options .mm-opt-btn.active')?.dataset.val || 'all';
        const vibeVal = document.querySelector('#mm-vibe-options .mm-opt-btn.active')?.dataset.val || 'any';
        const durVal = document.querySelector('#mm-duration-options .mm-opt-btn.active')?.dataset.val || 'any';
        const eraVal = document.querySelector('#mm-era-options .mm-opt-btn.active')?.dataset.val || 'any';
        const popVal = document.querySelector('#mm-pop-options .mm-opt-btn.active')?.dataset.val || 'any';

        // Combined Candidate Pool (Watchlist + Unseen Movies)
        const watchlistItems = this.data.all.filter(m => this.data.watchlist.includes(m.id));
        const unseenItems = this.data.all.filter(m => !this.data.seen.find(s => s.id === m.id));
        
        let pool = [...watchlistItems, ...unseenItems];
        // Deduplicate pool
        const uniqueMap = {};
        pool.forEach(item => uniqueMap[item.id] = item);
        pool = Object.values(uniqueMap);

        if (pool.length === 0) {
            this.showToast('אין מספיק תוכן בקטלוג להמלצה');
            return;
        }

        // Apply Filters
        const filtered = pool.filter(item => {
            // Genre
            if (genreVal !== 'all' && item.genre_ids && !item.genre_ids.includes(parseInt(genreVal))) return false;
            
            // Duration
            const runtime = item.runtime || 105;
            if (durVal === 'short' && runtime > 95) return false;
            if (durVal === 'medium' && (runtime < 85 || runtime > 125)) return false;
            if (durVal === 'long' && runtime < 115) return false;

            // Era
            const yr = item.release_date ? parseInt(item.release_date.split('-')[0]) : 2020;
            if (eraVal === 'new' && yr < 2020) return false;
            if (eraVal === 'classic' && (yr < 1985 || yr > 2015)) return false;

            // Popularity
            const votes = item.vote_count || 500;
            if (popVal === 'hit' && votes < 800) return false;
            if (popVal === 'gem' && votes > 1000) return false;

            return true;
        });

        const finalCandidates = filtered.length >= 3 ? filtered : pool;

        // Calculate Match Score %
        const topUserGenres = [];
        const topSeen = [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000)).slice(0, 5);
        topSeen.forEach(m => { if (m.genre_ids) topUserGenres.push(...m.genre_ids); });

        const scoredResults = finalCandidates.map(item => {
            let score = (item.vote_average || 7.5) * 10; // Base score out of 100
            
            // Bonus for matching user's top genres
            if (item.genre_ids && item.genre_ids.some(gId => topUserGenres.includes(gId))) {
                score += 12;
            }

            // Bonus if item is in Watchlist
            if (this.data.watchlist.includes(item.id)) {
                score += 15;
            }

            // Small jitter for freshness
            score += Math.random() * 5;

            let matchPct = Math.min(Math.round(score), 99);
            if (matchPct < 70) matchPct = 70 + Math.floor(Math.random() * 15);

            return { item, matchPct };
        }).sort((a, b) => b.matchPct - a.matchPct).slice(0, 4);

        // Render Results View
        document.getElementById('mm-wizard-steps').style.display = 'none';
        const resView = document.getElementById('mm-results-view');
        resView.style.display = 'block';

        const listDiv = document.getElementById('mm-results-list');
        listDiv.innerHTML = '';

        scoredResults.forEach(({ item, matchPct }) => {
            const card = document.createElement('div');
            card.className = 'mm-result-card';
            const imgUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/100x150';
            const isWatchlist = this.data.watchlist.includes(item.id);

            card.innerHTML = `
                <img src="${imgUrl}" alt="${item.hebrew_title || item.title}">
                <div class="mm-res-info">
                    <div class="mm-res-header">
                        <h4>${item.hebrew_title || item.title}</h4>
                        <span class="match-score-badge">🔥 ${matchPct}% התאמה</span>
                    </div>
                    <div class="mm-res-meta">
                        <span>${item.release_date ? item.release_date.split('-')[0] : ''}</span> · 
                        <span>${item.vote_average ? item.vote_average + ' ⭐' : ''}</span>
                    </div>
                    <div class="mm-res-actions">
                        <button class="btn-primary btn-sm" onclick="window.markWatchlistSeen(${item.id}); this.textContent='נצפה! ✅'">
                            ראיתי כבר!
                        </button>
                        ${!isWatchlist ? `
                            <button class="btn-secondary btn-sm" onclick="window.toggleWatchlist(${item.id}); this.textContent='שמור! 📌'">
                                📌 שמרתי לצפייה
                            </button>
                        ` : '<span class="saved-tag">📌 ברשימת צפייה</span>'}
                    </div>
                </div>
            `;
            listDiv.appendChild(card);
        });
    }

    renderWatchlist() {
        const tbody = document.getElementById('watchlist-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        this.data.all.filter(m => this.data.watchlist.includes(m.id)).forEach(m => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><img src="${url}" class="mini-poster"></td>
                <td><strong>${m.hebrew_title}</strong><br><small>${m.title}</small></td>
                <td>
                    <div class="list-actions">
                        <button class="list-btn btn-seen" onclick="window.markWatchlistSeen(${m.id})" title="ראיתי">
                            <i data-lucide="check"></i>
                        </button>
                        <button class="list-btn btn-remove" onclick="window.removeWatchlist(${m.id})" title="הסר">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        if (window.lucide) window.lucide.createIcons();
    }

    registerGlobals() {
        window.removeWatchlist = (id) => { 
            this.data.watchlist = this.data.watchlist.filter(wid => wid !== id); 
            this.saveToLocalStorage(); 
            this.renderWatchlist(); 
            this.showToast('הוסר מרשימת הצפייה');
        };

        window.removeSeen = (id) => {
            if (confirm('בטוח שברצונך להסיר תוכן זה מהדירוג שלך?')) {
                this.data.seen = this.data.seen.filter(s => s.id !== id);
                // Also reset ELO and stats for this item if needed? Let's keep it simple for now.
                this.saveToLocalStorage();
                this.renderStats();
                this.showToast('הוסר מהדירוג');
            }
        };
        
        window.markWatchlistSeen = (id) => {
            const movie = this.data.all.find(m => m.id === id);
            if (movie && !this.data.seen.find(s => s.id === id)) {
                this.data.seen.push(movie);
            }
            this.data.watchlist = this.data.watchlist.filter(wid => wid !== id); 
            this.saveToLocalStorage(); 
            this.renderWatchlist();
            this.showToast('סומן כנצפה!'); 
        };
        
        window.toggleWatchlist = (id) => {
            if (this.data.watchlist.includes(id)) {
                this.data.watchlist = this.data.watchlist.filter(wid => wid !== id);
                this.showToast('הוסר מרשימת הצפייה');
            } else {
                this.data.watchlist.push(id);
                this.showToast('נוסף לרשימת הצפייה');
                if (!this.data.history) this.data.history = [];
                this.data.history.push({ id, action: 'watchlist' });
            }
            this.saveToLocalStorage();
            this.renderCurrentView();
        };
    }

    setupGeneralEvents() {
        this.registerGlobals();
        
        // Name personalization
        const nameInput = document.getElementById('user-name-input');
        if (nameInput) {
            nameInput.value = this.userName;
        }
        const saveNameBtn = document.getElementById('save-name');
        if (saveNameBtn) {
            saveNameBtn.onclick = () => {
                const val = nameInput.value.trim();
                if (val) {
                    this.userName = val;
                    localStorage.setItem('kenlo_user_name', val);
                    this.updateHeaderName();
                    this.showToast(`שלום ${val}! הפרופיל שלך עודכן.`);
                }
            };
        }

        // Copy formatted text for Gemini
        const copyBtn = document.getElementById('copy-stats');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const sorted = [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000));
                if (sorted.length === 0) {
                    this.showToast('אין עדיין תוכן מדורג להעתקה!');
                    return;
                }
                
                let text = `--- דירוג ה${this.contentType === 'movie' ? 'סרטים' : 'סדרות'} שלי ב-KenLo ---\n\n`;
                sorted.forEach((m, i) => {
                    const score = this.getNormScore(m.id);
                    text += `${i+1}. ${m.hebrew_title || m.title} (ציון: ${score})\n`;
                });
                
                if (this.data.watchlist.length > 0) {
                    text = text.trim() + `\n\n--- רשימת צפייה (${this.contentType === 'movie' ? 'סרטים' : 'סדרות'}) ---\n`;
                    this.data.all.filter(m => this.data.watchlist.includes(m.id)).forEach(m => {
                        text += `- ${m.hebrew_title || m.title}\n`;
                    });
                }

                navigator.clipboard.writeText(text).then(() => {
                    this.showToast('הרשימה הועתקה! עכשיו אפשר להדביק ב-Gemini');
                });
            };
        }

        document.getElementById('export-data').onclick = () => {
            const blob = new Blob([JSON.stringify({
                movieData: this.movieData,
                tvData: this.tvData
            }, null, 2)], {type:'application/json'});
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kenlo_full_backup.json'; a.click();
        };

        const updateBtn = document.getElementById('update-app');
        if (updateBtn) {
            updateBtn.onclick = async () => {
                this.showToast('בודק עדכונים...');
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (let reg of regs) {
                        await reg.update();
                    }
                }
                this.showToast('מעדכן גרסה...');
                setTimeout(() => {
                    const cleanUrl = window.location.href.split('#')[0].split('?')[0];
                    window.location.href = cleanUrl + '?v=' + Date.now();
                }, 1000);
            };
        }

        document.getElementById('reset-app').onclick = () => { 
            if (confirm(`בטוח שתרצה למחוק את כל הנתונים?`)) { 
                localStorage.clear();
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
