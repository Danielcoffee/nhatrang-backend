import express from 'express';
import cors from 'cors';
import { Client, AccountId, PrivateKey, TokenAssociateTransaction, TransferTransaction, AccountBalanceQuery, AccountCreateTransaction } from "@hashgraph/sdk";

const app = express();

// CORS configuration for production
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

// 🔐 PRODUCTION CONFIG - Environment Variables
const OPERATOR_ACCOUNT_ID = "0.0.6939984";
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY || "7b5faacb18fdd45bffeddfdfaff97f28d1f1f7da0103dccb3a0b7911bde89bf3";
const TOKEN_ID = "0.0.6940016";


// 🔧 THÊM SIMPLE DATABASE (dùng array - production dùng MongoDB)
let userDatabase = [];

// 🔧 PARTNER SUBSCRIPTION SYSTEM

// In-memory database (sau này chuyển sang MongoDB)
let partnersDatabase = [];
let subscriptionsDatabase = [];

// 🔧 SUBSCRIPTION PLANS
const SUBSCRIPTION_PLANS = {
    basic: {
        name: "Basic",
        monthlyFee: 500000, // 500k VND
        pointsLimit: 1000,
        features: ["QR Scanner", "Basic Dashboard", "1000 points/month"]
    },
    premium: {
        name: "Premium", 
        monthlyFee: 1000000, // 1M VND
        pointsLimit: 5000,
        features: ["QR Scanner", "Advanced Analytics", "5000 points/month", "Priority Support"]
    }
};

// 🔧 API: GET SUBSCRIPTION PLANS
app.get('/api/subscription/plans', (req, res) => {
    res.json({
        success: true,
        plans: SUBSCRIPTION_PLANS
    });
});

// 🔧 API: PARTNER SUBSCRIPTION
app.post('/api/partners/subscribe', async (req, res) => {
    try {
        const { businessName, phone, email, planType } = req.body;
        
        if (!businessName || !phone || !planType) {
            return res.json({ success: false, message: 'Thiếu thông tin đăng ký' });
        }

        // Kiểm tra plan hợp lệ
        if (!SUBSCRIPTION_PLANS[planType]) {
            return res.json({ success: false, message: 'Gói subscription không hợp lệ' });
        }

        console.log(`🏪 New partner subscription: ${businessName} - ${planType}`);

        // Tạo partner ID
        const partnerId = 'P' + Date.now();
        
        // Tạo subscription
        const subscription = {
            partnerId: partnerId,
            businessName: businessName,
            phone: phone,
            email: email || '',
            planType: planType,
            monthlyFee: SUBSCRIPTION_PLANS[planType].monthlyFee,
            status: 'pending', // pending, active, cancelled
            joinDate: new Date().toISOString(),
            trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days trial
        };

        // Lưu vào database
        partnersDatabase.push(subscription);
        
        console.log(`✅ Partner registered: ${partnerId} - ${businessName}`);

        res.json({
            success: true,
            message: `Đăng ký thành công! Bạn có 30 ngày dùng thử. Phí: ${SUBSCRIPTION_PLANS[planType].monthlyFee.toLocaleString()}VND/tháng`,
            partner: {
                id: partnerId,
                businessName: businessName,
                plan: planType,
                monthlyFee: SUBSCRIPTION_PLANS[planType].monthlyFee,
                status: 'pending',
                trialEnds: subscription.trialEnds
            },
            nextSteps: "Chúng tôi sẽ liên hệ để xác nhận và kích hoạt tài khoản."
        });

    } catch (error) {
        console.error('Subscription error:', error);
        res.json({ 
            success: false, 
            message: 'Lỗi đăng ký: ' + error.message 
        });
    }
});

// 🔧 API: ACTIVATE PARTNER (sau khi payment confirmed)
app.post('/api/partners/activate', (req, res) => {
    try {
        const { partnerId } = req.body;
        
        const partner = partnersDatabase.find(p => p.partnerId === partnerId);
        if (!partner) {
            return res.json({ success: false, message: 'Partner không tồn tại' });
        }

        partner.status = 'active';
        partner.activatedAt = new Date().toISOString();
        
        console.log(`✅ Partner activated: ${partnerId} - ${partner.businessName}`);

        res.json({
            success: true,
            message: 'Partner đã được kích hoạt!',
            partner: partner
        });

    } catch (error) {
        console.error('Activation error:', error);
        res.json({ 
            success: false, 
            message: 'Lỗi kích hoạt: ' + error.message 
        });
    }
});

// 🔧 API: GET PARTNER INFO
app.get('/api/partners/:partnerId', (req, res) => {
    try {
        const partner = partnersDatabase.find(p => p.partnerId === req.params.partnerId);
        
        if (!partner) {
            return res.json({ success: false, message: 'Partner không tồn tại' });
        }

        res.json({
            success: true,
            partner: partner
        });

    } catch (error) {
        res.json({ 
            success: false, 
            message: 'Lỗi lấy thông tin partner: ' + error.message 
        });
    }
});

// 🔧 API: GET ALL PARTNERS (Admin)
app.get('/api/admin/partners', (req, res) => {
    try {
        res.json({
            success: true,
            partners: partnersDatabase,
            total: partnersDatabase.length,
            active: partnersDatabase.filter(p => p.status === 'active').length,
            pending: partnersDatabase.filter(p => p.status === 'pending').length
        });

    } catch (error) {
        res.json({ 
            success: false, 
            message: 'Lỗi lấy danh sách partners: ' + error.message 
        });
    }
});


// 🔧 FUNCTION TÌM USER THEO SĐT
function findUserByPhone(phone) {
    return userDatabase.find(user => user.phone === phone);
}

// 🔧 FUNCTION LƯU USER MỚI
function saveUser(user) {
    const existingUser = findUserByPhone(user.phone);
    if (existingUser) {
        // Update existing user
        Object.assign(existingUser, user);
    } else {
        // Add new user
        userDatabase.push(user);
    }
    console.log(`💾 Saved user: ${user.phone} -> ${user.hederaAccountId}`);
}


// Khởi tạo Hedera Client
const client = Client.forTestnet();

async function initializeClient() {
    try {
        const operatorPrivateKey = PrivateKey.fromString(OPERATOR_PRIVATE_KEY);
        
        client.setOperator(
            AccountId.fromString(OPERATOR_ACCOUNT_ID),
            operatorPrivateKey
        );
        
        console.log('✅ Hedera Client initialized - PRODUCTION READY');
        console.log(`💰 Operator: ${OPERATOR_ACCOUNT_ID}`);
        console.log(`🎯 Token ID: ${TOKEN_ID}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        
        const balance = await getTokenBalance(OPERATOR_ACCOUNT_ID);
        console.log(`💰 Token Balance: ${balance.toString()} NTP`);
        
    } catch (error) {
        console.error('❌ Lỗi khởi tạo client:', error);
        throw error;
    }
}

// ==================== API ROUTES ====================

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: '🚀 Nha Trang Rewards Backend - PRODUCTION',
        network: 'Hedera Testnet',
        accountId: OPERATOR_ACCOUNT_ID,
        tokenId: TOKEN_ID,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Token Balance
app.get('/api/token-balance', async (req, res) => {
    try {
        const balance = await getTokenBalance(OPERATOR_ACCOUNT_ID);
        res.json({
            success: true,
            balance: balance.toString(),
            tokenId: TOKEN_ID,
            accountId: OPERATOR_ACCOUNT_ID
        });
    } catch (error) {
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Register New User
app.post('/api/register', async (req, res) => {
    try {
        const { phone, name } = req.body;
        
        if (!phone) {
            return res.json({ success: false, message: 'Thiếu số điện thoại' });
        }
        
        console.log(`📱 Đăng ký user: ${phone}`);
        
        // 🔧 KIỂM TRA USER ĐÃ TỒN TẠI CHƯA
        const existingUser = findUserByPhone(phone);
        if (existingUser) {
            console.log(`✅ User đã tồn tại: ${existingUser.hederaAccountId}`);
            return res.json({
                success: true,
                message: 'User đã tồn tại trong hệ thống',
                user: existingUser,
                existing: true
            });
        }
        
        // 🔧 TẠO ACCOUNT MỚI CHO USER
        const userAccountInfo = await createHederaAccount();
        
        // 🔧 THÊM ĐIỂM CHÀO MỪNG
        const transactionId = await addPoints(userAccountInfo.accountId, 50);
        
        // 🔧 TẠO USER OBJECT
        const newUser = {
            phone: phone,
            name: name || `Khách hàng ${phone}`,
            hederaAccountId: userAccountInfo.accountId,
            points: 50,
            createdAt: new Date().toISOString(),
            transactions: [transactionId]
        };
        
        // 🔧 LƯU VÀO DATABASE
        saveUser(newUser);
        
        res.json({
            success: true,
            message: 'Đăng ký thành công! Nhận ngay 50 điểm chào mừng 🎁',
            user: newUser,
            transactionId: transactionId,
            welcomeBonus: 50
        });
        
    } catch (error) {
        console.error('Lỗi đăng ký:', error);
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});


// 🔧 API THÊM ĐIỂM CHO USER ĐÃ CÓ
app.post('/api/add-points-to-phone', async (req, res) => {
    try {
        const { phone, points, partnerId } = req.body;
        
        if (!phone || !points) {
            return res.json({ success: false, message: 'Thiếu thông tin' });
        }
        
        console.log(`🎁 Thêm ${points} điểm cho SĐT: ${phone}`);
        
        // 🔧 TÌM USER THEO SĐT
        const user = findUserByPhone(phone);
        if (!user) {
            return res.json({ 
                success: false, 
                message: 'Không tìm thấy user với SĐT này' 
            });
        }
        
        // 🔧 THÊM ĐIỂM VÀO ACCOUNT THẬT
        const transactionId = await addPoints(user.hederaAccountId, parseInt(points));
        
        // 🔧 CẬP NHẬT ĐIỂM TRONG DATABASE
        user.points += parseInt(points);
        user.transactions.push(transactionId);
        
        res.json({
            success: true,
            message: `Đã thêm ${points} điểm cho ${phone}!`,
            user: user,
            transactionId: transactionId,
            partnerId: partnerId || 'qr_scanner'
        });
        
    } catch (error) {
        console.error('Lỗi thêm điểm:', error);
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Add Points to User
app.post('/api/add-points', async (req, res) => {
    try {
        const { userAccountId, points, partnerId } = req.body;
        
        if (!userAccountId || !points) {
            return res.json({ success: false, message: 'Thiếu thông tin' });
        }
        
        console.log(`🎁 [PRODUCTION] Thêm ${points} điểm cho ${userAccountId}`);
        
        const transactionId = await addPoints(userAccountId, parseInt(points));
        const newBalance = await getTokenBalance(userAccountId);
        
        res.json({
            success: true,
            message: `Đã thêm ${points} điểm thành công!`,
            transactionId,
            newBalance: newBalance.toString(),
            partnerId: partnerId || 'system'
        });
        
    } catch (error) {
        console.error('Lỗi thêm điểm:', error);
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get User Balance
app.get('/api/balance/:accountId', async (req, res) => {
    try {
        const balance = await getTokenBalance(req.params.accountId);
        res.json({
            success: true,
            balance: balance.toString(),
            accountId: req.params.accountId
        });
    } catch (error) {
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Test Endpoint
app.post('/api/test-add-points', async (req, res) => {
    try {
        const { points } = req.body;
        const pointsToAdd = parseInt(points) || 10;
        
        console.log(`🧪 [PRODUCTION] Test thêm ${pointsToAdd} điểm`);
        
        const transactionId = await addPoints(OPERATOR_ACCOUNT_ID, pointsToAdd);
        const newBalance = await getTokenBalance(OPERATOR_ACCOUNT_ID);
        
        res.json({
            success: true,
            message: `Test thành công! Đã thêm ${pointsToAdd} điểm`,
            transactionId,
            newBalance: newBalance.toString(),
            accountId: OPERATOR_ACCOUNT_ID
        });
        
    } catch (error) {
        console.error('Lỗi test:', error);
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ==================== HEDERA FUNCTIONS ====================

async function createHederaAccount() {
    let retries = 3;
    
    while (retries > 0) {
        try {
            console.log(`🔄 Tạo Hedera account (attempt ${4-retries}/3)...`);
            
            const userPrivateKey = PrivateKey.generate();
            
            // THÊM DELAY giữa các transaction
            if (retries < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // 1. TẠO ACCOUNT
            const accountCreateTx = new AccountCreateTransaction()
                .setKey(userPrivateKey.publicKey)
                .setInitialBalance(0)
                .freezeWith(client);
                
            const accountCreateSign = await accountCreateTx.sign(userPrivateKey);
            const accountCreateSubmit = await accountCreateSign.execute(client);
            const accountCreateReceipt = await accountCreateSubmit.getReceipt(client);
            const userAccountId = accountCreateReceipt.accountId.toString();
            
            console.log(`✅ Đã tạo Hedera account: ${userAccountId}`);
            
            // 2. ASSOCIATE TOKEN - THÊM RETRY VÀ CHỜ
            console.log(`🔗 Associating token với account...`);
            const associateTx = await new TokenAssociateTransaction()
                .setAccountId(userAccountId)
                .setTokenIds([TOKEN_ID])
                .freezeWith(client)
                .sign(userPrivateKey);
            
            const associateSubmit = await associateTx.execute(client);
            const associateReceipt = await associateSubmit.getReceipt(client); // ✅ QUAN TRỌNG: Chờ receipt
            
            console.log(`✅ Đã associate token với account ${userAccountId}`);
            
            // 3. CHỜ 2 GIÂY ĐẢM BẢO ASSOCIATE COMPLETE
            console.log(`⏳ Chờ association hoàn tất...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return {
                accountId: userAccountId,
                privateKey: userPrivateKey.toString()
            };
            
        } catch (error) {
            retries--;
            console.error(`❌ Lỗi tạo account (${error.status}):`, error.message);
            
            if (retries === 0) {
                throw new Error(`Lỗi tạo Hedera account sau 3 lần thử: ${error.message}`);
            }
            
            console.log(`⏳ Chờ 2 giây trước khi thử lại...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function addPoints(userAccountId, points) {
    try {
        const transaction = await new TransferTransaction()
            .addTokenTransfer(TOKEN_ID, userAccountId, points)
            .addTokenTransfer(TOKEN_ID, OPERATOR_ACCOUNT_ID, -points)
            .freezeWith(client);
        
        const operatorPrivateKey = PrivateKey.fromString(OPERATOR_PRIVATE_KEY);
        const signedTransaction = await transaction.sign(operatorPrivateKey);
        
        const response = await signedTransaction.execute(client);
        const receipt = await response.getReceipt(client);
        
        let transactionId = 'unknown';
        if (receipt.transactionId) {
            transactionId = receipt.transactionId.toString();
        } else if (response.transactionId) {
            transactionId = response.transactionId.toString();
        } else {
            transactionId = `manual-${Date.now()}`;
        }
        
        console.log(`✅ Đã thêm ${points} điểm cho ${userAccountId}`);
        console.log(`📝 Transaction: ${transactionId}`);
        
        return transactionId;
        
    } catch (error) {
        console.error(`❌ Lỗi trong addPoints:`, error);
        throw new Error(`Lỗi thêm điểm: ${error.message}`);
    }
}

async function getTokenBalance(accountId) {
    try {
        const balance = await new AccountBalanceQuery()
            .setAccountId(accountId)
            .execute(client);
        
        const tokenBalance = balance.tokens.get(TOKEN_ID) || 0;
        return tokenBalance;
    } catch (error) {
        throw new Error(`Lỗi kiểm tra số dư: ${error.message}`);
    }
}

// Khởi chạy Server
initializeClient().then(() => {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`\n🎉 ===========================================`);
        console.log(`🚀 NHATRANG REWARDS BACKEND - PRODUCTION READY`);
        console.log(`📍 Port: ${PORT}`);
        console.log(`💰 Account: ${OPERATOR_ACCOUNT_ID}`);
        console.log(`🎯 Token: ${TOKEN_ID}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 Health: http://localhost:${PORT}`);
        console.log(`===========================================\n`);
    });
}).catch(error => {
    console.error('❌ Không thể khởi chạy server:', error);
    process.exit(1);
});