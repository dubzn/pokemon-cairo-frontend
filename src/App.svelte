<script>
	import CardList from "./cards.svelte";
	import CardListDaily from "./cards-mint.svelte";
	import Card from "./lib/components/card.svelte";
	import CardMinted from "./lib/components/card-minted.svelte";
	import CardPackGlowing from "./lib/components/card-pack-glowing.svelte";
	import CardPackTxInProgress from "./lib/components/card-pack-tx-progress.svelte";
	import CardPackOff from "./lib/components/card-pack-off.svelte";
  	import { onMount } from "svelte";
	import * as contract from './contract/main.json';
	import pokemon from "./contract/data.json";
	import { stringToFeltArray } from "./utils/utils.js";
	import { timer, time } from "./utils/countdown.js";

	import { Account, Contract, ec, number, uint256, defaultProvider } from "starknet";
	import { connect, disconnect } from "get-starknet"
	
	const POKEMON_CONTRACT_ADDRESS = "0x03a1db2968737c3b2797accd5f3d6c9daf15c563e4a8de0ad061e88a42043739"
	const ipfs_url = "https://ipfs.io/ipfs/QmcPpMHw41aeiw3zGL2FrVCbXKBgfGZcmtb2BoZzSdcqF8"
    const CARDS_DECK = 69;
	const DAILY_MINT_STATUS_KEY = "daily_mint_status"
	const DAILY_SEND_CARD_STATUS_KEY = "daily_send_card_status"
	const DEPLOY_SCOPE = "testnet." // for mainnet, leave empty

	const DAILY_MINT = "dailyMint"
	const OWNED_CARDS = "ownedCards"
	const DAILY_TRADE = "dailyTrade"
	
	let provider;
	let address;
	let isConnected = false;
	let walletModalVisible;
	let pokemonContract;
	
	let mintedCards;
	let mintedTodayCards;
	let userTradeData;
	let isLoading = true;
	let isLoadingMintedToday = true;
	let isLoadingTradeData = true;
	let isLoadingBlockTime = true;

	let addressToSendCard;
	let addressToSearch;
	let cardSelectedToSend;

	let dailyMintTxStatus = {};
	let dailySendCardTxStatus = {};

	let nextDayMintCountDown;

	let paramWallet;
	const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.get("wallet")) {
		let resp = urlParams.get("wallet").match('^0x[a-fA-F0-9]*')
		if (resp != null) {
			paramWallet = urlParams.get("wallet");
		}
	}

	const connectWallet = async() => {   
		try{
			walletModalVisible = true
			const wallet = await connect({modalOptions: {theme: "dark"}});

			if (wallet) {
				await wallet.enable({ showModal: true });
				isConnected = wallet.isConnected    
				provider = wallet.account     
				address = wallet.selectedAddress   

				if (paramWallet) {
					if (paramWallet.toLowerCase().includes(address.substring(2).toLowerCase())) {
						paramWallet = null;
					} else {
						address = paramWallet
					}
				}
				
				pokemonContract = new Contract(contract.abi, POKEMON_CONTRACT_ADDRESS, provider);
				walletModalVisible = false
				var data = { provider, address, isConnected}
				
				return data
			}
		}   catch(error){     
			walletModalVisible = false
			console.log(error.message)
		}
	}

	const sendCardToWallet = async() => {
		try {
			if ((addressToSendCard == undefined || addressToSendCard == "") || cardSelectedToSend == undefined) {
				window.alert("Address or card cannot be empty!")
				return;
			}
			pokemonContract = new Contract(contract.abi, POKEMON_CONTRACT_ADDRESS, provider);
			let sendCardResponse = await pokemonContract.send_card(addressToSendCard, uint256.bnToUint256(number.toBN(cardSelectedToSend, 16)))
			
			if (sendCardResponse.transaction_hash != "0x0") {
				localStorage.setItem(DAILY_SEND_CARD_STATUS_KEY, JSON.stringify({status: "RECEIVED", txHash: sendCardResponse.transaction_hash}))
				dailySendCardTxStatus.status = "RECEIVED"
				dailySendCardTxStatus.txHash = sendCardResponse.transaction_hash
			} else {
				localStorage.setItem(DAILY_SEND_CARD_STATUS_KEY, JSON.stringify({status: "NOT_RECEIVED", txHash: sendCardResponse.transaction_hash}))
			}

			await provider.waitForTransaction(sendCardResponse.transaction_hash)
			refresh([OWNED_CARDS, DAILY_TRADE])

		} catch (error) {
			console.log("Error while trying to send card: ", error)
		}
	}

	const getDailyTradeData = async() => {
		try {
			isLoadingTradeData = true
			let trade = {}

			pokemonContract = new Contract(contract.abi, POKEMON_CONTRACT_ADDRESS, provider);
			let dailyTradeResponse = await pokemonContract.get_user_daily_trade(address)

			trade.dailySend = Math.floor((parseInt(dailyTradeResponse) / 10))
			trade.dailyReceive = (parseInt(dailyTradeResponse) % 10)
			return trade
		} catch (error) {
			console.log(error)
		}
	}

	const mintDailyCards = async() => {
		try {
			pokemonContract = new Contract(contract.abi, POKEMON_CONTRACT_ADDRESS, provider);
			let dailyMintCardsResponse = await pokemonContract.mint_daily_cards()
			
			if (dailyMintCardsResponse.transaction_hash != "0x0") {
			 	localStorage.setItem(DAILY_MINT_STATUS_KEY, JSON.stringify({status: "RECEIVED", txHash: dailyMintCardsResponse.transaction_hash}))
				dailyMintTxStatus.status = "RECEIVED"
				dailyMintTxStatus.txHash = dailyMintCardsResponse.transaction_hash
			} else {
				localStorage.setItem(DAILY_MINT_STATUS_KEY, JSON.stringify({status: "NOT_RECEIVED", txHash: dailyMintCardsResponse.transaction_hash}))
			}
			
			await provider.waitForTransaction(dailyMintCardsResponse.transaction_hash)
			refresh([OWNED_CARDS, DAILY_MINT])
					
		} catch (error) {
			console.log(error)
		}
	}

	const getCards = async () => {
		isLoading=true;
		const accounts = Array(CARDS_DECK).fill(address.toString())
		var ids = []
		for (var i = 1; i <= CARDS_DECK; i++) {
			ids.push(uint256.bnToUint256(number.toBN(i, 16)));
		}

		var cards = []

		let balanceResponse = await pokemonContract.balanceOfBatch(accounts, ids);
		
		for (var i = 0; i < CARDS_DECK; i++) {
			var id = i;
			var quantity = number.toBN(balanceResponse.balances[i].low, 16) ? number.toBN(balanceResponse.balances[i].low, 16).toString() : "0";
			if (parseInt(quantity) > 0) {
				cards.push({id, quantity})
			}	
		}
		return cards;
	};

	const getCardsMintedToday = async () => {
		isLoadingMintedToday = true
		let cardsMinted = await pokemonContract.get_user_claimed_pack(address)
		let cards = []

		let cardsInString = cardsMinted.toString()

		if (cardsInString.length == 1) {
			return cards;
		}

		if (cardsInString.length % 2 != 0) {
			cardsInString = "0" + cardsInString;
		}

		for (var i = cardsInString.length - 1; i >= 0; i-=2) {
			cards.push(parseInt(cardsInString[i-1] + cardsInString[i]))
		}

		return cards;
	};

	const handleDisconnect = async () =>{
		disconnect( {clearLastWallet: true, clearDefaultWallet: true} );
		isConnected=false
		mintedCards = []
		mintedTodayCards = []
	}

	const updateDailyMintTransactionStatus = async () => {
		var dailyMintTxStored = localStorage.getItem(DAILY_MINT_STATUS_KEY)
		if (dailyMintTxStored != undefined) {
			let data = JSON.parse(localStorage.getItem(DAILY_MINT_STATUS_KEY))

			let txStatus = await defaultProvider.getTransactionReceipt(data.txHash)
			localStorage.setItem(DAILY_MINT_STATUS_KEY, JSON.stringify({status: txStatus.status, txHash: txStatus.transaction_hash}))
			dailyMintTxStatus.status = txStatus.status
			dailyMintTxStatus.txHash = txStatus.transaction_hash

			switch(data.status) {
				case "NOT_RECEIVED":
					localStorage.removeItem(DAILY_MINT_STATUS_KEY)
					break;
				case "ACCEPTED_ON_L1":
				case "ACCEPTED_ON_L2":
					localStorage.removeItem(DAILY_MINT_STATUS_KEY)
					refresh([OWNED_CARDS, DAILY_MINT])
					break;
				case "RECEIVED":
				case "PENDING":
					await provider.waitForTransaction(dailyMintTxStatus.txHash)
					refresh([OWNED_CARDS, DAILY_MINT])
					break;
				default:
					break;
			}
		} 
	}

	const updateDailyTradeTransactionStatus = async () => {
		var dailySendCardTxStored = localStorage.getItem(DAILY_SEND_CARD_STATUS_KEY)
		if (dailySendCardTxStored != undefined) {
			let data = JSON.parse(localStorage.getItem(DAILY_SEND_CARD_STATUS_KEY))
			
			let txStatus = await defaultProvider.getTransactionReceipt(data.txHash)
			localStorage.setItem(DAILY_SEND_CARD_STATUS_KEY, JSON.stringify({status: txStatus.status, txHash: txStatus.transaction_hash}))
			dailySendCardTxStatus.status = txStatus.status
			dailySendCardTxStatus.txHash = txStatus.transaction_hash
		
			switch(data.status) {
				case "NOT_RECEIVED":
					localStorage.removeItem(DAILY_SEND_CARD_STATUS_KEY)
					break;
				case "ACCEPTED_ON_L1":
				case "ACCEPTED_ON_L2":
					localStorage.removeItem(DAILY_SEND_CARD_STATUS_KEY)
					refresh([OWNED_CARDS, DAILY_TRADE])
					break;
				case "RECEIVED":
				case "PENDING":
					await provider.waitForTransaction(dailySendCardTxStatus.txHash)
					refresh([OWNED_CARDS, DAILY_TRADE])
					break;
				default:
					break;
			}
		} 
	}

	const refresh = async (params) => { 
		if (params.includes(DAILY_MINT)) {
			isLoadingMintedToday = true;
			calculateNextDayMint()
			getCardsMintedToday().then((mintedToday) => { 
				mintedTodayCards = mintedToday; 
				isLoadingMintedToday = false; });
		} 
		if (params.includes(DAILY_TRADE)) {
			isLoadingTradeData = true;
			getDailyTradeData().then((trade)  => { userTradeData = trade; isLoadingTradeData = false; });
		}
		if (params.includes(OWNED_CARDS)) {
			isLoading = true;
			getCards().then((cards) => { mintedCards = cards; isLoading = false; });	
		}
	}

	const init = async () => {
		connectWallet().then(data => {
		provider = data.provider
		address = data.address
		isConnected = data.isConnected

		updateDailyMintTransactionStatus()
		updateDailyTradeTransactionStatus()

		if (isConnected) {
			const account = new Account(
				provider,
				address,
				ec.getKeyPair("")
			);	
			pokemonContract.connect(account);
			refresh([DAILY_MINT, DAILY_TRADE, OWNED_CARDS])
		}
		})
	}

	init()

	const calculateNextDayMint = async () => {
		isLoadingBlockTime = true;
		let blockTime = await pokemonContract.blockTimestamp();
		let nextMintDay = new Date((blockTime) * 1000);
		nextMintDay.setDate(nextMintDay.getDate() + 1)
		nextMintDay.setUTCHours(0);
		nextMintDay.setUTCMinutes(0);
		nextMintDay.setUTCSeconds(0);
		nextDayMintCountDown = (nextMintDay.valueOf() / 1000) - (Date.now().valueOf() / 1000);
		timer.start(nextDayMintCountDown * 1000)
		isLoadingBlockTime = false;
	}

	const handleSearchKeyPressed = async (key) => {
		if(key.code == 'Enter' && addressToSearch) {
			let matchWithWalletRegex = addressToSearch.match('^0x[a-fA-F0-9]*')
			if (matchWithWalletRegex) {
				let url =  window.location.origin
				window.location.replace(url + "?wallet=" + addressToSearch)
			}
		} 
	}

	// console.log(stringToFeltArray("ipfs://Qme8n4HBTyt8rvLr6bX5XiT6vCLsNkVNK8NjAw66esYQQ5/")) // contract metadata
	// console.log(stringToFeltArray("ipfs://QmemtWG3sHr5aFPGxsPCaxdv9qotWYChf17PLiepAvfMwy/")) // metadata cartas
	// console.log(stringToFeltArray("ipfs://QmaBVymFCD7EX9HYZPfgQCsvbmDeuGfEajsGd7a8mz4ofi/")) // last contract cartas
	
	onMount(() => {
		const $headings = document.querySelectorAll("h1,h2,h3");
		const $anchor = [...$headings].filter((el) => {
			const id = el.getAttribute("id")?.replace(/^.*?-/g,"");
			const hash = window.location.hash?.replace(/^.*?-/g,"")
			return id === hash;
		})[0];
		if( $anchor ) {
			setTimeout(() => {
				$anchor.scrollIntoView();
			},100);
		}
	});

</script>

<main>
	<header>
		<div class="header-inside">
			<h1 id="⚓-top">Cairo Pokemon Cards</h1> 
			<section class="intro" id="⚓-intro">
				<p>
					This is a collection of <mark>NFTs</mark> (with no real value) based on the first pack of the original Pokemon sets (nerd stuff).
					This is <mark>NOT</mark> intended for any kind of monetary benefit, it is simply for fun and to learn more about Blockchain/Starknet ecosystem.
					I do <b>not</b> own the art found on the cards, all rights reserved to their creators.
				</p>
				<br>
				<p>
					You can claim a pack per day (contains 5 cards), once the day has passed it cannot be minted. 
					It is based on the ERC1155 standard, so cards can be transferred with other users (one trade per day is allowed).
				</p>
				<br>
				<p>
					In principle the base set contains 102 cards, but in this case we will remove the trainer and energy cards (a total of 69 cards remain). 
				</p>

				<p>
					This frontend is an adaptation of <a href="https://twitter.com/simeydotme" style="color: rgb(66, 219, 240);" target="_blank" rel="noreferrer"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Twitter</title><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/> </svg> @simeydotme</a> work.
				</p>
				<br/>
				<p>
					Backend in Cairo by <a href="https://twitter.com/dub_zn" style="color: rgb(66, 219, 240);" target="_blank" rel="noreferrer"><svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Twitter</title><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/> </svg>@dub_zn</a>.
				</p>
				<br/>
				<p>
					You can see the PokeCairo collection in <a href="https://testnet.aspect.co/collection/{POKEMON_CONTRACT_ADDRESS}" style="color: rgb(66, 219, 240);" target="_blank" rel="noreferrer">Aspect</a> or <a href="https://mintsquare.io/collection/starknet-testnet/{POKEMON_CONTRACT_ADDRESS}" style="color: rgb(66, 219, 240);" target="_blank" rel="noreferrer">Mintsquare</a> (both Starknet testnet).
				</p>
			</section>
			{#if !walletModalVisible}
				<div class="showcase">
					<Card 
						img={"https://i.ibb.co/yqKsRHQ/gengar-cairo.png"}
						rarity="Rare Ultra" />
				</div> 
			{:else}
				<div class="showcase" style="z-index: 0">
					<Card 
						img={"https://i.ibb.co/yqKsRHQ/gengar-cairo.png"}
						rarity="Rare Ultra" />
				</div> 
			{/if}
		</div>
		<div class="mint-menu" >
			<div class="mint-menu-title">
				<h1>Cards obtained today</h1>
			</div> 
			<CardListDaily>
				{#if isConnected}
					{#if isLoadingMintedToday}
						<div> <CardPackOff 
							img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
							rarity="Common" />
						</div>
						{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}			
					{:else if !isLoadingMintedToday && mintedTodayCards.length == 0}
						{#if dailyMintTxStatus != undefined && (dailyMintTxStatus.status == "RECEIVED" || dailyMintTxStatus.status == "PENDING")}
							<a href="https://{DEPLOY_SCOPE}starkscan.co/tx/{dailyMintTxStatus.txHash}" target="_blank" rel="noreferrer">
								<div class="card-tag" style="background-color: rgba(213, 21, 238, 0.8);">TX IN PROGRESS</div>
								<div> <CardPackTxInProgress 
										img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
										rarity="Common" />
								</div>
							</a>
							{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}
						{:else}
							{#if !paramWallet} 
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<div on:click={() => mintDailyCards()} >
								<div class="card-tag" style="background-color: rgba(13, 199, 0, 0.8);">READY TO CLAIM</div>
									<CardPackGlowing
										img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
										rarity="Rare Holo V"
									/>
							</div>
							{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}
							{:else}
								<div> <CardPackOff 
									img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
									rarity="Common" />
								</div>
								{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}			
							{/if}
						{/if}
					{:else}
						{#if !isLoadingMintedToday && mintedTodayCards.length > 1}
							{#if !paramWallet} 
								<div>
									<div class="card-tag" style="background-color: rgba(255, 0, 0, 0.8);">
										OUT OF STOCK
										{#if !isLoadingBlockTime}
											<div class="countdown" >{$time}</div>
										{/if}
									</div>
									<CardPackOff 
										img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
										rarity="Common"
									/>
								</div>
							{:else}
								<div> <CardPackOff 
									img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
									rarity="Common" />
								</div>
							{/if}
							{#each mintedTodayCards as card, i}
								{#if card <= 15} <CardMinted img={ipfs_url+"/"+ (card) +".png"} rarity="Rare Holo V"/> {/if}
								{#if card > 15} <CardMinted img={ipfs_url+"/"+ (card) +".png"} rarity="Common"/>{/if}
							{/each}
						{/if}
					{/if}
				{:else}
					{#if isLoadingMintedToday}
						<div> <CardPackOff 
							img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
							rarity="Common" />
						</div>
						{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}			
					{:else}
					<div> <CardPackOff 
						img={"https://i.ibb.co/2Ykx1Tg/base-set.jpg"}
						rarity="Common" />
					</div>
					{#each Array(5) as _, i} <div> <CardMinted /> </div> {/each}		
					{/if}
				{/if}
			</CardListDaily>
		</div>
	</header>

	<br>
	<header style="grid-template-columns: 1fr 1fr; width: 100%;">
		<div class="inside-header2">
			{#if isLoadingTradeData}
				<h1 id="⚓-top">
					Loading trade stats..
				</h1>
			{:else}
				<h1 id="⚓-top">
					Daily trades status
				</h1>
			{/if}
			
			<div class="daily-trade-menu" style="width: 100%;">
				{#if !isLoadingTradeData && userTradeData.dailySend == 0}
						{#if dailySendCardTxStatus != undefined && (dailySendCardTxStatus.status == "RECEIVED" || dailySendCardTxStatus.status == "PENDING")}
							<a href="https://{DEPLOY_SCOPE}starkscan.co/tx/{dailySendCardTxStatus.txHash}" target="_blank" rel="noreferrer">
								<div class="flags" style="background-color: rgba(213, 21, 238, 0.8);">Transaction in progress..</div>
							</a>
						{:else}
							<div class="flags" style="background-color: rgba(0, 204, 102, 0.8);">Can send a card</div>	
						{/if}
				{:else}
					<div class="flags" style="background-color: rgba(255, 255, 255, 0.3);">Already send a card</div>
				{/if}
					
				{#if !isLoadingTradeData && userTradeData.dailyReceive == 0}
					<div class="flags" style="background-color: rgba(0, 204, 102, 0.8);">Can receive a card</div>
				{:else}
					<div class="flags" style="background-color: rgba(255, 255, 255, 0.3);">Already receive a card</div>
				
				{/if}
			</div>
			{#if !isLoading && !isLoadingTradeData && userTradeData.dailySend == 0 && !paramWallet}
				<h2>Send a card</h2>
				<input class="input-wallet" placeholder="Wallet address.." bind:value={addressToSendCard}>
				<div class="daily-trade-menu" style="width: 100%;">	
					<select placeholder="Select card to send.." bind:value={cardSelectedToSend}>
						{#each mintedCards as card}
							<option value={card.id + 1}>
								#{card.id + 1} {pokemon.data[card.id].name} (x{card.quantity})
							</option>
						{/each}
					</select>
					<button class="flags" on:click={() => sendCardToWallet()} style="background-color: rgba(21, 161, 222, 0.9);">Send selected card</button>
				</div>
			{/if}
		</div>
		<div class="inside-header2" style="margin-right:0px;">
			<h1 id="⚓-top">Wallet stats </h1>
			{#if isLoading}
				<h2>Loading cards..</h2>
			{:else}
				<h2>Minted cards {mintedCards.length}/69</h2>
			{/if}
			{#if isConnected && !paramWallet}
				<div class="daily-trade-menu" style="width: 100%; grid-template-columns: 75% 25%;">
					<div class="flags" style="background-color: rgba(255, 255, 255, 0.3)">{address}</div>
					<!-- svelte-ignore a11y-click-events-have-key-events -->
					<button class="flags" style="background-color: rgba(21, 161, 222, 0.9)"
						on:click={() => handleDisconnect()}>Disconnect</button>
				</div>
			{:else if !paramWallet}
			<div class="daily-trade-menu" style="width: 100%; grid-template-columns: 1fr;">
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<button class="flags" style="background-color: rgba(21, 161, 222, 0.9)"
					on:click={() => init() }>
						Connect Wallet<br />
				</button>
			</div>
			{/if}
			<h2>Search Wallet </h2>
			<input class="input-wallet" 
				style="margin-bottom: 0px; background-image: url('https://cdn-icons-png.flaticon.com/512/149/149852.png'" 
				placeholder="Search Wallet.." 
				on:keydown={(key) => handleSearchKeyPressed(key)}
				bind:value={addressToSearch}>
		</div>
	</header>
	<br>
	<CardList>
		{#if isLoading}
			Loading..
		{:else}
			{#each mintedCards as card, i}
				{#if card.quantity > 0}	
					{#if card.id <= 15}
						<Card 
							img={ipfs_url+"/"+ (card.id+1) +".png"}
							number= {card.id+1}
							quantity={card.quantity}
							rarity="Rare Holo V"
						/>
					{/if}
					{#if card.id > 15}
						<Card 
							img={ipfs_url+"/"+ (card.id+1) +".png"}
							number= {card.id+1}
							quantity={card.quantity}
							rarity="Common"
						/>
					{/if}
				{/if}
			{/each}
		{/if}
	</CardList>
</main>
<br>

<div class="back-to-top">
  <a href="#top">Back to Top</a>
</div>

<!-- <input class="input-wallet" style={"width: 10%; position: fixed; bottom: 1em; right: 9em; padding: 10px 20px 12px 40px; margin-bottom: 0; background-image: url('https://cdn-icons-png.flaticon.com/512/149/149852.png'"} placeholder="Search Wallet.." bind:value={addressToSearch}> -->

<style>

  .back-to-top a {
    color: inherit;
    text-decoration: none;
  }

  main {
	margin: auto;
	max-width: max-content;
  }
</style>
