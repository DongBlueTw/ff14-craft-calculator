const { createApp, ref, computed, reactive, inject, provide, onMounted, watch } = Vue;

// ─── API 來源 (改為讀取本地 MessagePack 檔案) ────────────────────────────────
const RECIPES_URL = "./data/recipes.msgpack";
const ITEMS_TW_URL = "./data/items-tw.msgpack";

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

    const MAX_SAVED = 5;
    const LS_RECIPES_KEY = "ff14_saved_recipes";
    const LS_PRICES_KEY = "ff14_saved_prices";
    const savedRecipes = ref([]); 

    const MAX_HISTORY = 3;
    const LS_HISTORY_KEY = "ff14_history_recipes";
    const historyRecipes = ref([]);

    const isMobileSidebarOpen = ref(false);

    const isLoading = ref(true);
    const loadingMsg = ref("正在連線取得高效能配方庫...");

    let rawRecipes = {};
    let rawItemNames = {};
    let resultToRecipeMap = {};

    provide("methods", methods);
    provide("includeCrystals", includeCrystals);

    // ── 資料載入 (更新為 MessagePack 邏輯) ───────────────────────────────────
    const initData = async () => {
      try {
        loadingMsg.value = "正在下載高效能資料庫... (請稍候)";
        
        // 抓取 msgpack 二進位檔案
        const [itemsRes, recipesRes] = await Promise.all([
          fetch(ITEMS_TW_URL),
          fetch(RECIPES_URL)
        ]);

        if (!itemsRes.ok || !recipesRes.ok) {
          throw new Error("無法讀取資料檔案，請確認 data 資料夾中是否存在 msgpack 檔案。");
        }

        // 讀取為 ArrayBuffer
        const itemsBuffer = await itemsRes.arrayBuffer();
        const recipesBuffer = await recipesRes.arrayBuffer();

        loadingMsg.value = "正在解析資料...";
        // 使用 MessagePack 解碼
        rawItemNames = MessagePack.decode(new Uint8Array(itemsBuffer));
        const recipesArray = MessagePack.decode(new Uint8Array(recipesBuffer));

        loadingMsg.value = "正在建立計算機索引...";
        await new Promise((r) => setTimeout(r, 10));

        // 建立索引 (注意鍵名改為瘦身版的 r.res)
        for (const r of recipesArray) {
          if (r && r.res && !resultToRecipeMap[r.res]) {
            resultToRecipeMap[r.res] = r;
          }
        }
        rawRecipes = recipesArray;
        isLoading.value = false;

        const storedPrices = JSON.parse(localStorage.getItem(LS_PRICES_KEY) || "{}");
        Object.assign(prices, storedPrices);
        savedRecipes.value = JSON.parse(localStorage.getItem(LS_RECIPES_KEY) || "[]");
        historyRecipes.value = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]");
      } catch (err) {
        console.error("Data loading error:", err);
        loadingMsg.value = `資料庫載入失敗：${err.message}`;
      }
    };

    // ── 建立配方樹 (更新鍵名對應) ─────────────────────────────────────────────
    const buildRecipeTree = (recipeObj) => {
      const resultId = recipeObj.res; // 瘦身版鍵名
      // 瘦身版結構直接是對應字串，不再有 .tw
      const itemName = rawItemNames[resultId] ?? `Unknown Item (${resultId})`;

      const materials = (recipeObj.ing ?? []).map((ing) => {
        const matName = rawItemNames[ing.id] ?? `Unknown Item (${ing.id})`;
        const isCrystal = ing.id >= 2 && ing.id <= 19;
        const subRecipe = resultToRecipeMap[ing.id];

        return subRecipe
          ? {
              id: ing.id,
              name: matName,
              quantity: ing.amt, // 瘦身版鍵名
              isCraftable: true,
              isCrystal,
              yield: subRecipe.yld || 1, // 瘦身版鍵名
              subMaterials: buildRecipeTree(subRecipe).materials,
            }
          : {
              id: ing.id,
              name: matName,
              quantity: ing.amt, // 瘦身版鍵名
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
        yield: recipeObj.yld || 1, // 瘦身版鍵名
        materials,
      };
    };

    // ── 搜尋 (更新鍵名對應) ───────────────────────────────────────────────────
    const doSearch = () => {
      if (!searchQuery.value || searchQuery.value.length < 2) {
        searchResults.value = [];
        return;
      }
      const q = searchQuery.value.toLowerCase();
      const results = [];
      
      // rawItemNames 的 value 現在直接是字串
      for (const [itemId, name] of Object.entries(rawItemNames)) {
        if (name?.toLowerCase().includes(q)) {
          const possibleRecipe = resultToRecipeMap[itemId];
          if (possibleRecipe) {
            results.push({
              rawRecipe: possibleRecipe,
              name: name,
              yield: possibleRecipe.yld || 1, // 瘦身版鍵名
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

      const newHist = {
        resultId: selectedRecipe.value.resultId,
        name: selectedRecipe.value.name,
        yield: selectedRecipe.value.yield
      };
      historyRecipes.value = historyRecipes.value.filter(h => h.resultId !== newHist.resultId);
      historyRecipes.value.unshift(newHist);
      if (historyRecipes.value.length > MAX_HISTORY) {
        historyRecipes.value = historyRecipes.value.slice(0, MAX_HISTORY);
      }
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(historyRecipes.value));
    };

    onMounted(initData);

    watch(prices, (val) => {
      localStorage.setItem(LS_PRICES_KEY, JSON.stringify(val));
    }, { deep: true });

    const saveCurrentRecipe = () => {
      if (!selectedRecipe.value) return;
      const { resultId, name } = selectedRecipe.value;
      const yieldQty = selectedRecipe.value.yield;

      const isAlreadySaved = savedRecipes.value.some(r => r.resultId === resultId);
      
      if (!isAlreadySaved && savedRecipes.value.length >= MAX_SAVED) {
        alert(`【收藏清單已滿】\n\n目前的收藏配方已經達到上限 (${MAX_SAVED} 筆) 囉！\n若要收藏新的配方，請先至左欄刪除一些較少用的配方。`);
        return;
      }

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

    const untaxedTotalCost = computed(() => {
      if (totalCost.value === null) return null;
      return totalCost.value / 1.05;
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
      untaxedTotalCost,
      formatGil,
      copyName,
      isLoading,
      loadingMsg,
      isMobileSidebarOpen,
      savedRecipes,
      saveCurrentRecipe,
      removeSavedRecipe,
      loadSavedRecipe,
      isCurrentSaved,
      MAX_SAVED,
      historyRecipes,
    };
  },
}).mount("#app");