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
            pages: { 'movie/popular':0, 'movie/top_rated':0, 'discover/movie':0, 'movie/now_playing':0 }
        };
        this.tvData = {
            all: [],
            seen: [],
            notSeen: {},
            watchlist: [],
            history: [],
            elo: {},
            pages: { 'tv/popular':0, 'tv/top_rated':0, 'discover/tv':0, 'tv/on_the_air':0, 'tv/israeli':0 }
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
        
        this.init();
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
        this.setupModeToggle();
        this.renderGenreSelectors();
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
            if (!this.movieData.history) this.movieData.history = [];
            if (!this.tvData.history) this.tvData.history = [];
            
            this.contentType = parsed.lastMode || 'movie';
            
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
        document.getElementById('swipe-no').onclick = () => {
            const top = this.cardStack.lastElementChild;
            if (top && !top.classList.contains('stack-placeholder')) this.swipe(top, 'left');
        };
        const undoBtn = document.getElementById('swipe-undo');
        if (undoBtn) undoBtn.onclick = () => this.undo();
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
        const pool = this.data.seen.filter(m => {
            if (this.selectedBattleGenre === 'all') return true;
            return m.genre_ids && m.genre_ids.includes(parseInt(this.selectedBattleGenre));
        });

        if (pool.length < 2) {
            arena.innerHTML = `<div class="stack-placeholder">צריך לפחות 2 ${this.getTerm('plural')} שראית ב-"${GENRES[this.selectedBattleGenre] || 'ז\'אנר זה'}" כדי להלחם!</div>`;
            return;
        }

        const idxA = Math.floor(Math.random() * pool.length);
        let idxB = Math.floor(Math.random() * pool.length);
        while (idxB === idxA) idxB = Math.floor(Math.random() * pool.length);
        this.currentMatch = { a: pool[idxA], b: pool[idxB] };

        // Reset arena classes before rendering new movies
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
        const Ra = this.data.elo[idA] || 1000, Rb = this.data.elo[idB] || 1000, K = 32;
        const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400)), Eb = 1 / (1 + Math.pow(10, (Ra - Rb) / 400));
        this.data.elo[idA] = Math.round(Ra + K * (outcome - Ea));
        this.data.elo[idB] = Math.round(Rb + (K * ((1 - outcome) - Eb)));
    }

    // --- Stats & Watchlist ---
    renderStats() {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        [...this.data.seen].sort((a,b) => (this.data.elo[b.id]||1000) - (this.data.elo[a.id]||1000)).forEach((m, i) => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${i+1}</td><td><img src="${url}" class="mini-poster"></td><td><strong>${m.hebrew_title}</strong><br><small>${m.title}</small></td><td><span class="rank-badge">${this.data.elo[m.id]}</span></td>`;
            tbody.appendChild(tr);
        });
    }

    renderWatchlist() {
        const tbody = document.getElementById('watchlist-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        this.data.all.filter(m => this.data.watchlist.includes(m.id)).forEach(m => {
            const url = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/40x60';
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><img src="${url}" class="mini-poster"></td><td><strong>${m.hebrew_title}</strong><br><small>${m.title}</small></td><td>
                <button class="btn-success btn-sm" onclick="window.markWatchlistSeen(${m.id})">ראיתי</button>
                <button class="btn-danger btn-sm" onclick="window.removeWatchlist(${m.id})">הסר</button>
            </td>`;
            tbody.appendChild(tr);
        });
    }

    registerGlobals() {
        window.removeWatchlist = (id) => { 
            this.data.watchlist = this.data.watchlist.filter(wid => wid !== id); 
            this.saveToLocalStorage(); 
            this.renderWatchlist(); 
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
                    const score = this.data.elo[m.id] || 1000;
                    text += `${i+1}. ${m.hebrew_title || m.title} (${Math.round(score)} Elo)\n`;
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
        
        document.getElementById('reset-app').onclick = () => { 
            if (confirm(`בטוח שתרצה למחוק את כל נתוני ה${this.contentType === 'movie' ? 'סרטים' : 'סדרות'}?`)) { 
                if (this.contentType === 'movie') {
                    this.movieData = { all: [], seen: [], notSeen: {}, watchlist: [], el: {}, pages: { 'movie/popular':0, 'movie/top_rated':0, 'discover/movie':0, 'movie/now_playing':0 } };
                } else {
                    this.tvData = { all: [], seen: [], notSeen: {}, watchlist: [], el: {}, pages: { 'tv/popular':0, 'tv/top_rated':0, 'discover/tv':0, 'tv/on_the_air':0, 'tv/israeli':0 } };
                }
                this.saveToLocalStorage(); 
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
