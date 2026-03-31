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

    async fetchContentMixed(batchSize = 5) {
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
                    pages[endpoint]++;
                    const page = pages[endpoint];
                    
                    let extraParams = '';
                    let usePage = page;
                    
                    if (endpoint.includes('discover')) {
                        extraParams = '&sort_by=vote_count.desc&vote_count.gte=100';
                        usePage = Math.floor(Math.random() * 200) + 1;
                    } else if (endpoint === 'tv/israeli') {
                        const ilPage = Math.floor(Math.random() * 5) + 1;
                        const urlIL = `https://api.themoviedb.org/3/discover/tv?api_key=${this.tmdbKey}&language=he-IL&with_origin_country=IL&page=${ilPage}&sort_by=popularity.desc`;
                        await this.fetchAndAdd(urlIL, fetchType);
                        continue;
                    }
                    
                    const baseEndpoint = endpoint === 'tv/israeli' ? 'discover/tv' : endpoint;
                    const url = `https://api.themoviedb.org/3/${baseEndpoint}?api_key=${this.tmdbKey}&language=he-IL&page=${usePage}${extraParams}`;
                    await this.fetchAndAdd(url, fetchType);
                }
            }
            
            this.shuffleArray(this.data.all);
            
            this.renderCurrentView();
        } catch (e) { console.error("Fetch failed:", e); } finally { this.isFetching = false; }
    }

    async fetchAndAdd(url, targetType) {
        const res = await fetch(url);
        const data = await res.json();
        if (data.results) {
            data.results.forEach(item => {
                if (item.genre_ids && item.genre_ids.includes(16)) return;
                
                const isEnglishOrHebrew = item.original_language === 'en' || item.original_language === 'he';
                const isIsraeli = targetType === 'tv' && item.origin_country && item.origin_country.includes('IL');
                const isGlobalHit = item.vote_count >= 1000 && item.vote_average >= 7.5;
                const isWeirdAsian = ['hi', 'ja', 'ko', 'zh', 'ta', 'te', 'ml', 'th', 'tr'].includes(item.original_language);
                
                // Block explicit Bollywood/Anime unless immense global hit
                if (isWeirdAsian && !isGlobalHit) return;
                // Additionally block Turkish Soap Operas if not global hits
                if (item.original_language === 'tr' && targetType === 'tv' && item.vote_count < 200) return;
                
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
                            vote_count: item.vote_count
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
        swipeContainer.innerHTML = '<button class="genre-chip active" data-genre="all">הכל</button>';
        
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
        });

        // Battle select listener removed
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

        // Tournament Dashboard Actions
        document.getElementById('start-t-btn').onclick = () => {
            const poolSize = this.data.seen.length;
            if (poolSize < 8) {
                alert('צריך לפחות 8 סרטים שראית כדי להתחיל טורניר!');
                return;
            }
            
            if (this.data.tournament && !confirm('יש טורניר פעיל. להתחיל חדש ולמחוק את הקיים?')) return;
            
            // Allow user to select size based on pool
            let size = 32;
            if (poolSize >= 128) size = 128;
            else if (poolSize >= 64) size = 64;
            else if (poolSize >= 32) size = 32;
            else if (poolSize >= 16) size = 16;
            else size = 8;

            this.initTournament(size);
        };

        document.getElementById('view-t-groups').onclick = () => {
            this.showTournamentView('groups');
        };

        document.getElementById('view-t-bracket').onclick = () => {
            this.showTournamentView('bracket');
        };

        document.getElementById('back-to-t-dash').onclick = () => this.showTournamentView('dashboard');
        document.getElementById('back-to-t-dash-2').onclick = () => this.showTournamentView('dashboard');
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
        document.getElementById(`tournament-${viewName}`).style.display = 'block';
        if (viewName === 'groups') this.renderGroups();
        if (viewName === 'bracket') this.renderBracket();
    }

    initTournament(size) {
        // Seeding: Sort by ELO
        const sortedPool = [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000));
        const participants = sortedPool.slice(0, size);
        
        if (size < 16) {
            // Pure Knockout for small pools
            const rounds = this.createEmptyBracket(size);
            
            // Seed first round
            this.shuffleArray(participants);
            rounds[0].matches.forEach((m, idx) => {
                m.a = participants[idx*2].id;
                m.b = participants[idx*2+1].id;
            });

            this.data.tournament = {
                status: 'bracket',
                participants: participants,
                groups: [],
                bracket: rounds,
                playedCount: 0,
                totalMatches: rounds.reduce((acc, r) => acc + r.matches.length, 0)
            };
        } else {
            // Groups of 8 (as requested "relatively large groups")
            const groupsCount = size / 8; 
            const groups = [];
            for (let i = 0; i < groupsCount; i++) {
                groups.push({
                    name: String.fromCharCode(65 + i),
                    members: [],
                    matches: [],
                    results: {}
                });
            }

            // Distribute participants into pots
            const itemsPerGroup = 8;
            for (let potIdx = 0; potIdx < itemsPerGroup; potIdx++) {
                const pot = participants.slice(potIdx * groupsCount, (potIdx + 1) * groupsCount);
                this.shuffleArray(pot);
                pot.forEach((p, gIdx) => {
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
                });
            }

            // Generate matches for each group (Round Robin)
            groups.forEach(group => {
                for (let i = 0; i < group.members.length; i++) {
                    for (let j = i + 1; j < group.members.length; j++) {
                        group.matches.push({
                            id: `${group.name}-${i}-${j}`,
                            a: group.members[i].id,
                            b: group.members[j].id,
                            winner: null
                        });
                    }
                }
                this.shuffleArray(group.matches); 
            });

            this.data.tournament = {
                status: 'groups',
                participants: participants,
                groups: groups,
                bracket: null,
                playedCount: 0,
                totalMatches: groups.reduce((acc, g) => acc + g.matches.length, 0)
            };
        }

        this.saveToLocalStorage();
        this.renderTournament();
        this.showToast(`טורניר ${size} ${this.getTerm('plural')} יצא לדרך!`);
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
        if (!this.data.tournament) {
            this.showTournamentView('dashboard');
            document.getElementById('start-t-btn').style.display = 'block';
            document.getElementById('view-t-groups').style.display = 'none';
            document.getElementById('view-t-bracket').style.display = 'none';
            document.getElementById('t-current-stage').textContent = 'ממתין';
            document.getElementById('t-played-count').textContent = '0';
            return;
        }

        const t = this.data.tournament;
        document.getElementById('t-played-count').textContent = `${t.playedCount} / ${t.totalMatches || '?'}`;
        
        if (t.status === 'groups') {
            document.getElementById('t-current-stage').textContent = 'בתים';
            document.getElementById('view-t-groups').style.display = 'block';
            document.getElementById('view-t-bracket').style.display = 'none';
            
            // Find next match
            let nextMatch = null;
            let groupIdx = -1;
            for (let i = 0; i < t.groups.length; i++) {
                const match = t.groups[i].matches.find(m => m.winner === null);
                if (match) {
                    nextMatch = match;
                    groupIdx = i;
                    break;
                }
            }

            if (nextMatch) {
                this.renderTournamentMatch(nextMatch, 'groups', groupIdx);
            } else {
                // Group stage finished!
                this.showToast('שלב הבתים הסתיים! עוברים לנוקאאוט...');
                this.generateKnockoutStage();
            }
        } else if (t.status === 'bracket') {
            document.getElementById('t-current-stage').textContent = 'נוקאאוט';
            document.getElementById('view-t-groups').style.display = 'block';
            document.getElementById('view-t-bracket').style.display = 'block';
            
            // Find next match in bracket
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
                this.renderTournamentMatch(nextMatch, 'bracket', roundIdx);
            } else {
                // Check if tournament is over
                const lastRound = t.bracket[t.bracket.length - 1];
                const finalMatch = lastRound.matches[0];
                if (finalMatch.winner) {
                    this.renderTournamentWinner(finalMatch.winner);
                } else {
                    this.showToast('ממתין למשחקי השלבים הבאים...');
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
        
        const renderCard = (id, movie) => {
            const c = document.getElementById(id);
            const url = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750';
            c.innerHTML = `<img src="${url}"> <div class="info"><h3>${movie.hebrew_title || movie.title}</h3><small>${movie.title}</small></div>`;
            c.onclick = () => {
                this.handleTournamentWinner(movie.id, match, stage, stageIdx);
            };
        };

        renderCard('t-movie-a', movieA);
        renderCard('t-movie-b', movieB);
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
                
                // 2. Winner's Grand Champion Bonus (+100 ELO)
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
            table.className = 'group-table';
            let rowsHtml = `<div class="group-row group-header"><span class="m-name">סרט</span><span>מש'</span><span>נק'</span><span>ELO</span></div>`;
            g.members.forEach(m => {
                rowsHtml += `
                    <div class="group-row">
                        <span class="m-name">${m.name}</span>
                        <span>${m.played}</span>
                        <span><strong>${m.points}</strong></span>
                        <span><small>${this.data.elo[m.id]||1000}</small></span>
                    </div>
                `;
            });
            table.innerHTML = `<h4>בית ${g.name}</h4>${rowsHtml}`;
            grid.appendChild(table);
        });
    }

    generateKnockoutStage() {
        const t = this.data.tournament;
        const winners = [];
        t.groups.forEach(g => {
            winners.push(g.members[0].id); // 1st place
            winners.push(g.members[1].id); // 2nd place
        });

        const rounds = this.createEmptyBracket(winners.length);

        // Seed first round: 1st place vs 2nd place from different groups
        const groupFirsts = t.groups.map(g => g.members[0].id);
        const groupSeconds = t.groups.map(g => g.members[1].id);
        this.shuffleArray(groupSeconds);

        rounds[0].matches.forEach((m, idx) => {
            m.a = groupFirsts[idx];
            m.b = groupSeconds[idx];
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
        if (!t || !t.bracket) return;

        t.bracket.forEach(round => {
            const container = document.createElement('div');
            container.className = 'round-container';
            container.innerHTML = `<div class="round-name">${round.name}</div>`;
            round.matches.forEach(m => {
                const teamA = this.data.seen.find(mov => mov.id === m.a);
                const teamB = this.data.seen.find(mov => mov.id === m.b);
                const box = document.createElement('div');
                box.className = 'match-box';
                box.innerHTML = `
                    <div class="match-team ${m.winner && m.winner === m.a ? 'winner' : ''}">
                        <img src="${teamA ? 'https://image.tmdb.org/t/p/w92'+teamA.poster_path : ''}">
                        <span>${teamA ? (teamA.hebrew_title || teamA.title) : '???'}</span>
                    </div>
                    <div class="match-team ${m.winner && m.winner === m.b ? 'winner' : ''}">
                        <img src="${teamB ? 'https://image.tmdb.org/t/p/w92'+teamB.poster_path : ''}">
                        <span>${teamB ? (teamB.hebrew_title || teamB.title) : '???'}</span>
                    </div>
                `;
                container.appendChild(box);
            });
            view.appendChild(container);
        });
    }

    renderTournamentWinner(id) {
        const movie = this.data.seen.find(m => m.id === id);
        this.showTournamentView('dashboard');
        const dash = document.getElementById('tournament-dashboard');
        
        const winnerEl = document.createElement('div');
        winnerEl.className = 'winner-announcement';
        winnerEl.style.marginTop = '20px';
        winnerEl.style.textAlign = 'center';
        winnerEl.style.padding = '20px';
        winnerEl.style.background = 'rgba(34, 197, 94, 0.1)';
        winnerEl.style.borderRadius = '20px';
        winnerEl.style.border = '2px solid #22c55e';
        
        winnerEl.innerHTML = `
            <div style="font-size: 2rem; margin-bottom: 10px;">🏆 המנצח!</div>
            <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" style="width: 150px; border-radius: 10px; margin-bottom: 15px;">
            <h2>${movie.hebrew_title || movie.title}</h2>
            <p>לוחם אמיץ שגבר על כולם!</p>
            <button class="btn-primary" style="margin-top: 15px;" onclick="location.reload()">טורניר חדש</button>
        `;
        
        // Remove existing winner announcement if any
        const existing = dash.querySelector('.winner-announcement');
        if (existing) existing.remove();
        
        dash.appendChild(winnerEl);
        document.getElementById('start-t-btn').style.display = 'none';
    }

    // --- Stats & Watchlist ---
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
