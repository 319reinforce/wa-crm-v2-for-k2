(function () {
    let baseUrl = '';

    function join(path) {
        if (!baseUrl) return path;
        return baseUrl.replace(/\/$/, '') + path;
    }

    function requestJson(path) {
        return fetch(join(path)).then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
            return res.json();
        });
    }

    function maybeUseCache(cacheKey, force) {
        const store = window.AppStore;
        if (!store || force) return null;
        if (cacheKey === 'users' && store.state.users.length) return store.state.users;
        if (cacheKey === 'lifecycleDashboard' && store.state.lifecycleDashboard) return store.state.lifecycleDashboard;
        if (cacheKey === 'jbData' && store.state.jbData.length) return store.state.jbData;
        if (cacheKey === 'keeperData' && store.state.keeperData.length) return store.state.keeperData;
        return null;
    }

    function getUsers(options) {
        const force = !!(options && options.force);
        const cached = maybeUseCache('users', force);
        if (cached) return Promise.resolve(cached);
        return requestJson('/users').then((users) => {
            window.AppStore && window.AppStore.setUsers(users);
            return users;
        });
    }

    function getLifecycleDashboard(options) {
        const force = !!(options && options.force);
        const cached = maybeUseCache('lifecycleDashboard', force);
        if (cached) return Promise.resolve(cached);
        return requestJson('/lifecycle/dashboard')
            .then((dashboard) => {
                window.AppStore && window.AppStore.setLifecycleDashboard(dashboard && dashboard.ok ? dashboard : null);
                return dashboard;
            })
            .catch(() => null);
    }

    function getJoinbrands(options) {
        const force = !!(options && options.force);
        const cached = maybeUseCache('jbData', force);
        if (cached) return Promise.resolve(cached);
        return requestJson('/joinbrands').then((data) => {
            window.AppStore && window.AppStore.setJoinbrands(data);
            return data;
        });
    }

    function getKeeper(options) {
        const force = !!(options && options.force);
        const cached = maybeUseCache('keeperData', force);
        if (cached) return Promise.resolve(cached);
        return requestJson('/keeper').then((data) => {
            window.AppStore && window.AppStore.setKeeper(data);
            return data;
        });
    }

    function getUserMessages(phone) {
        return requestJson('/users/' + encodeURIComponent(phone) + '/messages');
    }

    window.ApiClient = {
        configure(opts) {
            baseUrl = (opts && opts.baseUrl) || '';
        },
        getUsers,
        getLifecycleDashboard,
        getJoinbrands,
        getKeeper,
        getUserMessages
    };
})();
