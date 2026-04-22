(function () {
    const state = {
        users: [],
        usersByPhone: new Map(),
        lifecycleDashboard: null,
        jbData: [],
        keeperData: [],
        fetchedAt: {
            users: 0,
            lifecycleDashboard: 0,
            jbData: 0,
            keeperData: 0
        }
    };

    function setUsers(users) {
        const list = Array.isArray(users) ? users : [];
        state.users = list;
        state.usersByPhone = new Map(
            list
                .filter((u) => u && u.phone)
                .map((u) => [String(u.phone), u])
        );
        state.fetchedAt.users = Date.now();
    }

    function setLifecycleDashboard(dashboard) {
        state.lifecycleDashboard = dashboard || null;
        state.fetchedAt.lifecycleDashboard = Date.now();
    }

    function setJoinbrands(data) {
        state.jbData = Array.isArray(data) ? data : [];
        state.fetchedAt.jbData = Date.now();
    }

    function setKeeper(data) {
        state.keeperData = Array.isArray(data) ? data : [];
        state.fetchedAt.keeperData = Date.now();
    }

    function getUserByPhone(phone) {
        if (!phone) return null;
        return state.usersByPhone.get(String(phone)) || null;
    }

    window.AppStore = {
        state,
        setUsers,
        setLifecycleDashboard,
        setJoinbrands,
        setKeeper,
        getUserByPhone
    };
})();
