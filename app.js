const { createApp, ref, computed, reactive, inject, provide, onMounted, watch } = Vue;


// ─── API 來源 ────────────────────────────────────────────────────────────────
const RECIPES_URL =
  "https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/recipes.json";
const ITEMS_TW_URL =
  "https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/master/libs/data/src/lib/json/tw/tw-items.json";

// ─── 共用 Utilities ───────────────────────────────────────────────────────────
const formatGil = (val) => {
  if (val === null || val === undefined) return "---";
  return Math.ceil(val).toLocaleString() + " G";
};

const copyName = (name) => {
  navigator.clipboard.writeText(name).catch((err) => {
    console.error("複製失敗:", err);
  });
};

/**
 * 計算「直購」成本（含 5% 買家稅），若未填價格則回傳 null
 */
const calcBuyCost = (priceRaw, quantity) => {
  if (priceRaw === "" || priceRaw === null || priceRaw === undefined)
    return null;
  return Number(priceRaw) * quantity * 1.05;
};

/**
 * 遞迴計算節點最優成本（直購 vs 自製取其低）
 * @returns {number|null} null 表示資訊不足
 */
function calculateNodeCost(mat, prices, includeCrystals) {
  if (mat.isCrystal && !includeCrystals) return 0;

  const buyTotal = calcBuyCost(prices[mat.id], mat.quantity);

  if (!mat.isCraftable) return buyTotal;

  let craftTotalForYield = 0;
  for (const sub of mat.subMaterials ?? []) {
    const subCost = calculateNodeCost(sub, prices, includeCrystals);
    if (subCost === null) {
      craftTotalForYield = null;
      break;
    }
    craftTotalForYield += subCost;
  }

  const craftTotal =
    craftTotalForYield !== null
      ? (craftTotalForYield / mat.yield) * mat.quantity
      : null;

  if (buyTotal !== null && craftTotal !== null)
    return Math.min(buyTotal, craftTotal);
  return buyTotal ?? craftTotal;
}

/**
 * 依照 buyCost / craftCost 決定建議方案
 * @returns {'buy'|'craft'|'none'}
 */
const resolveMethod = (buyCost, craftCost) => {
  if (buyCost !== null && craftCost !== null)
    return craftCost < buyCost ? "craft" : "buy";
  if (buyCost !== null) return "buy";
  if (craftCost !== null) return "craft";
  return "none";
};

// ─── Component: 遞迴材料節點（列表模式） ──────────────────────────────────────
const MaterialNode = {
  name: "material-node",
  template: "#material-node-template",
  props: {
    material: Object,
    prices: Object,
    depth: Number,
  },
  setup(props) {
    const includeCrystals = inject("includeCrystals");
    const isExpanded = ref(false);

    const buyCost = computed(() =>
      calcBuyCost(props.prices[props.material.id], props.material.quantity),
    );

    const craftCost = computed(() => {
      if (!props.material.isCraftable || !props.material.subMaterials)
        return null;
      let cost = 0;
      for (const sub of props.material.subMaterials) {
        const subCost = calculateNodeCost(
          sub,
          props.prices,
          includeCrystals.value,
        );
        if (subCost === null) return null;
        cost += subCost;
      }
      return (cost / props.material.yield) * props.material.quantity;
    });

    const selectedMethodType = computed(() =>
      props.material.isCraftable
        ? resolveMethod(buyCost.value, craftCost.value)
        : "buy",
    );

    const subtotal = computed(() => {
      if (props.material.isCrystal && !includeCrystals.value) return 0;
      return calculateNodeCost(
        props.material,
        props.prices,
        includeCrystals.value,
      );
    });

    // Valid sub-materials filtering logic for iteration
    const validSubMaterials = computed(() => {
      const subs = props.material.subMaterials ?? [];
      return includeCrystals.value ? subs : subs.filter((m) => !m.isCrystal);
    });

    return {
      includeCrystals,
      isExpanded,
      validSubMaterials,
      buyCost,
      craftCost,
      subtotal,
      selectedMethodType,
      formatGil,
      copyName,
    };
  },
};

// ─── Component: 樹狀材料節點（Tree 模式） ─────────────────────────────────────
const TreeNode = {
  name: "tree-node",
  template: "#tree-node-template",
  props: {
    material: Object,
    prices: Object,
    depth: Number,
    index: Number,
    total: Number,
    isRoot: { type: Boolean, default: false },
  },
  setup(props) {
    const includeCrystals = inject("includeCrystals");
    const isExpanded = ref(true);

    const validSubMaterials = computed(() => {
      const subs = props.material.subMaterials ?? [];
      return includeCrystals.value ? subs : subs.filter((m) => !m.isCrystal);
    });

    const buyCost = computed(() =>
      calcBuyCost(props.prices[props.material.id], props.material.quantity),
    );

    const craftCost = computed(() => {
      if (!props.material.isCraftable || !props.material.subMaterials)
        return null;
      let cost = 0;
      for (const sub of props.material.subMaterials) {
        const subCost = calculateNodeCost(
          sub,
          props.prices,
          includeCrystals.value,
        );
        if (subCost === null) return null;
        cost += subCost;
      }
      return (cost / props.material.yield) * props.material.quantity;
    });

    // Root 節點的總製作成本（直接加總所有 material，不乘 quantity）
    const rootCraftCost = computed(() => {
      if (!props.isRoot) return null;
      let total = 0;
      for (const mat of props.material.subMaterials) {
        const subCost = calculateNodeCost(
          mat,
          props.prices,
          includeCrystals.value,
        );
        if (subCost === null) return null;
        total += subCost;
      }
      return total;
    });

    const selectedMethodType = computed(() =>
      props.material.isCraftable
        ? resolveMethod(buyCost.value, craftCost.value)
        : "buy",
    );

    const isMissingPrice = computed(() => {
      const p = props.prices[props.material.id];
      return p === "" || p === null || p === undefined;
    });

    return {
      includeCrystals,
      isExpanded,
      validSubMaterials,
      buyCost,
      craftCost,
      rootCraftCost,
      selectedMethodType,
      isMissingPrice,
      formatGil,
      copyName,
    };
  },
};

// ─── Vue Root Instance ────────────────────────────────────────────────────────
createApp({
  components: { MaterialNode, TreeNode },
  setup() {
    const searchQuery = ref("");
    const searchResults = ref([]);
    const selectedRecipe = ref(null);

    const prices = reactive({});
    const methods = reactive({});
    const calcMode = ref("earn");
    const sellTaxRate = ref(0.05);
    const viewMode = ref("tree");
    const includeCrystals = ref(true);

    // ── 儲存配方（最多 5 筆） ──────────────────────────────────────────────────
    const MAX_SAVED = 5;
    const LS_RECIPES_KEY = "ff14_saved_recipes";
    const LS_PRICES_KEY = "ff14_saved_prices";
    const savedRecipes = ref([]); // [{ resultId, name, yield }]

    // ── 歷史紀錄（最多 3 筆） ──────────────────────────────────────────────────
    const MAX_HISTORY = 3;
    const LS_HISTORY_KEY = "ff14_history_recipes";
    const historyRecipes = ref([]);

    // 手機板選單切換狀態
    const isMobileSidebarOpen = ref(false);

    const isLoading = ref(true);
    const loadingMsg = ref("正在連線取得配方與中文翻譯庫 (~15MB)...");

    let rawRecipes = {};
    let rawItemNames = {};
    let resultToRecipeMap = {};

    provide("methods", methods);
    provide("includeCrystals", includeCrystals);

    // ── 資料載入 ──────────────────────────────────────────────────────────────
    const initData = async () => {
      try {
        loadingMsg.value = "正在下載中文物品資料庫... (請稍候)";
        rawItemNames = await (await fetch(ITEMS_TW_URL)).json();

        loadingMsg.value = "正在下載配方資料庫... (檔案較大，請耐心等待)";
        const recipesArray = await (await fetch(RECIPES_URL)).json();

        loadingMsg.value = "正在建立計算機索引...";
        // 放開主線程，避免 UI 凍結
        await new Promise((r) => setTimeout(r, 10));

        for (const r of Object.values(recipesArray)) {
          if (!resultToRecipeMap[r.result]) resultToRecipeMap[r.result] = r;
        }
        rawRecipes = recipesArray;
        isLoading.value = false;

        // 資料載入完畢後，才能安全讀取 localStorage（配方 rebuild 需要 resultToRecipeMap）
        const storedPrices = JSON.parse(localStorage.getItem(LS_PRICES_KEY) || "{}");
        Object.assign(prices, storedPrices);
        savedRecipes.value = JSON.parse(localStorage.getItem(LS_RECIPES_KEY) || "[]");
        historyRecipes.value = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]");
      } catch (err) {
        console.error("Data loading error:", err);
        loadingMsg.value = "資料庫載入失敗，可能發生網路錯誤。請重新整理。";
      }
    };

    // ── 建立配方樹 ────────────────────────────────────────────────────────────
    const buildRecipeTree = (recipeObj) => {
      const resultId = recipeObj.result;
      const itemName = rawItemNames[resultId]?.tw ?? `Unknown Item (${resultId})`;

      const materials = (recipeObj.ingredients ?? []).map((ing) => {
        const matName = rawItemNames[ing.id]?.tw ?? `Unknown Item (${ing.id})`;
        const isCrystal = ing.id >= 2 && ing.id <= 19;
        const subRecipe = resultToRecipeMap[ing.id];

        return subRecipe
          ? {
              id: ing.id,
              name: matName,
              quantity: ing.amount,
              isCraftable: true,
              isCrystal,
              yield: subRecipe.yields || 1,
              subMaterials: buildRecipeTree(subRecipe).materials,
            }
          : {
              id: ing.id,
              name: matName,
              quantity: ing.amount,
              isCraftable: false,
              isCrystal,
              yield: 1,
              subMaterials: null,
            };
      });

      return {
        id: recipeObj.id,
        resultId,
        name: itemName,
        yield: recipeObj.yields || 1,
        materials,
      };
    };

    // ── 搜尋 ──────────────────────────────────────────────────────────────────
    const doSearch = () => {
      if (!searchQuery.value || searchQuery.value.length < 2) {
        searchResults.value = [];
        return;
      }
      const q = searchQuery.value.toLowerCase();
      const results = [];
      for (const [itemId, names] of Object.entries(rawItemNames)) {
        if (names.tw?.toLowerCase().includes(q)) {
          const possibleRecipe = resultToRecipeMap[itemId];
          if (possibleRecipe) {
            results.push({
              rawRecipe: possibleRecipe,
              name: names.tw,
              yield: possibleRecipe.yields || 1,
            });
            if (results.length >= 50) break;
          }
        }
      }
      searchResults.value = results;
    };

    const confirmSearch = () => {
      if (searchResults.value.length > 0) selectRecipe(searchResults.value[0]);
    };

    const selectRecipe = (itemResult) => {
      selectedRecipe.value = buildRecipeTree(itemResult.rawRecipe);
      searchQuery.value = "";
      searchResults.value = [];
      if (!(selectedRecipe.value.resultId in prices)) {
        prices[selectedRecipe.value.resultId] = "";
      }
      isMobileSidebarOpen.value = false;

      // ── 新增至歷史紀錄 ──────────────────────────────────────────────────
      const newHist = {
        resultId: selectedRecipe.value.resultId,
        name: selectedRecipe.value.name,
        yield: selectedRecipe.value.yield
      };
      // 移除原有的（如果有的話），將新的推到最前面
      historyRecipes.value = historyRecipes.value.filter(h => h.resultId !== newHist.resultId);
      historyRecipes.value.unshift(newHist);
      if (historyRecipes.value.length > MAX_HISTORY) {
        historyRecipes.value = historyRecipes.value.slice(0, MAX_HISTORY);
      }
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(historyRecipes.value));
    };

    onMounted(initData);

    // prices 變動時自動存回 localStorage
    watch(prices, (val) => {
      localStorage.setItem(LS_PRICES_KEY, JSON.stringify(val));
    }, { deep: true });

    // ── 儲存/讀取配方 ─────────────────────────────────────────────────────────
    const saveCurrentRecipe = () => {
      if (!selectedRecipe.value) return;
      const { resultId, name } = selectedRecipe.value;
      const yieldQty = selectedRecipe.value.yield;

      const isAlreadySaved = savedRecipes.value.some(r => r.resultId === resultId);
      
      if (!isAlreadySaved && savedRecipes.value.length >= MAX_SAVED) {
        alert(`【收藏清單已滿】\n\n目前的收藏配方已經達到上限 (${MAX_SAVED} 筆) 囉！\n若要收藏新的配方，請先至左欄刪除一些較少用的配方。`);
        return;
      }

      // 已存在則移到最前（更新），否則新增
      const filtered = savedRecipes.value.filter((r) => r.resultId !== resultId);
      filtered.unshift({ resultId, name, yield: yieldQty });
      savedRecipes.value = filtered;
      localStorage.setItem(LS_RECIPES_KEY, JSON.stringify(savedRecipes.value));
    };

    const removeSavedRecipe = (resultId) => {
      savedRecipes.value = savedRecipes.value.filter((r) => r.resultId !== resultId);
      localStorage.setItem(LS_RECIPES_KEY, JSON.stringify(savedRecipes.value));
    };

    const loadSavedRecipe = (saved) => {
      const rawRecipe = resultToRecipeMap[saved.resultId];
      if (!rawRecipe) return;
      selectRecipe({ rawRecipe, name: saved.name, yield: saved.yield });
    };

    const isCurrentSaved = computed(() => {
      if (!selectedRecipe.value) return false;
      return savedRecipes.value.some((r) => r.resultId === selectedRecipe.value.resultId);
    });

    // ── 結算計算 ──────────────────────────────────────────────────────────────
    const totalCost = computed(() => {
      if (!selectedRecipe.value) return 0;
      let total = 0;
      for (const mat of selectedRecipe.value.materials) {
        const subCost = calculateNodeCost(mat, prices, includeCrystals.value);
        if (subCost === null) return null;
        total += subCost;
      }
      return total;
    });

    const salePrice = computed(() => {
      if (!selectedRecipe.value) return null;
      const p = prices[selectedRecipe.value.resultId];
      return p === "" || p === null || p === undefined ? null : Number(p);
    });

    const taxAmount = computed(() => {
      if (salePrice.value === null) return null;
      return salePrice.value * (selectedRecipe.value?.yield || 1) * sellTaxRate.value;
    });

    const profit = computed(() => {
      if (!selectedRecipe.value || totalCost.value === null || salePrice.value === null)
        return null;
      return (
        salePrice.value * selectedRecipe.value.yield -
        taxAmount.value -
        totalCost.value
      );
    });

    const directBuyCost = computed(() => {
      if (!selectedRecipe.value || salePrice.value === null) return null;
      return salePrice.value * selectedRecipe.value.yield * 1.05;
    });

    const saveDiff = computed(() => {
      if (directBuyCost.value === null || totalCost.value === null) return null;
      return directBuyCost.value - totalCost.value;
    });

    return {
      viewMode,
      calcMode,
      sellTaxRate,
      includeCrystals,
      searchQuery,
      searchResults,
      doSearch,
      confirmSearch,
      selectRecipe,
      selectedRecipe,
      prices,
      totalCost,
      profit,
      taxAmount,
      directBuyCost,
      saveDiff,
      formatGil,
      copyName,
      isLoading,
      loadingMsg,
      isMobileSidebarOpen,
      // 儲存配方
      savedRecipes,
      saveCurrentRecipe,
      removeSavedRecipe,
      loadSavedRecipe,
      isCurrentSaved,
      MAX_SAVED,
      // 歷史紀錄
      historyRecipes,
    };
  },
}).mount("#app");
