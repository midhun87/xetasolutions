const express = require('express');
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Use a dynamic import for the ES Module 'uuid' package
// We will call an async function to start the server
async function startServer() {
    const { v4: uuidv4 } = await import('uuid');

    const app = express();
    const PORT = 3000;

    // --- CONFIGURATIONS ---
    app.use(cors());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));


    // --- SERVE STATIC FILES ---
    app.use(express.static(__dirname));

    // --- CLOUDINARY CONFIGURATION ---
    cloudinary.config({
      cloud_name: 'dpz44zf0z',
      api_key: '939929349547989',
      api_secret: '7mwxyaqe-tvtilgyek2oR7lTkr8'
    });


    // --- MULTER SETUP ---
    const storage = multer.memoryStorage();
    const upload = multer({ storage: storage });

    // IMPORTANT: Replace with your actual credentials and settings
    const AWS_CONFIG = {
        region: 'ap-south-1',
        accessKeyId: 'AKIAT4YSUMZD755UHGW7',
        secretAccessKey: '+7xyGRP/P+5qZD955qgrC8GwvuOsA33wwzwe6abl'
    };
    const JWT_SECRET = 'YOUR_SUPER_SECRET_KEY_REPLACE_ME';
    const NODEMAILER_CONFIG = {
        service: 'gmail',
        auth: {
            user: 'YOUR_EMAIL@gmail.com',
            pass: 'YOUR_EMAIL_APP_PASSWORD'
        }
    };

    AWS.config.update(AWS_CONFIG);
    const dynamoDb = new AWS.DynamoDB.DocumentClient();
    const transporter = nodemailer.createTransport(NODEMAILER_CONFIG);

    // Table Names
    const USERS_TABLE = 'xeta_users';
    const TASKS_TABLE = 'xeta_tasks';
    const ATTENDANCE_TABLE = 'xeta_attendance';
    const DOCUMENTS_TABLE = 'xeta_documents';

    // --- MIDDLEWARE ---
    const authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.sendStatus(401);

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    };

    // --- PAGE ROUTES ---
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    // --- API ENDPOINTS ---

    // 1. LOGIN
    app.post('/login', async (req, res) => {
        const { userId, password } = req.body;
        const params = { TableName: USERS_TABLE, Key: { userId } };
        try {
            const { Item } = await dynamoDb.get(params).promise();
            if (Item && Item.password === password) {
                const userPayload = { userId: Item.userId, role: Item.role };
                const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '8h' });
                res.json({ success: true, message: 'Login successful', user: Item, token });
            } else {
                res.status(401).json({ success: false, message: 'Invalid credentials' });
            }
        } catch (error) {
            console.error("Login Error:", error);
            res.status(500).json({ success: false, message: 'Server error during login' });
        }
    });

    // --- MANAGEMENT ENDPOINTS ---

    // 2. CREATE EMPLOYEE
    app.post('/management/create-employee', authenticateToken, upload.single('profilePic'), async (req, res) => {
        if (req.user.role !== 'management') return res.sendStatus(403);
        
        let profilePicUrl = '';

        try {
            if (req.file) {
                const b64 = Buffer.from(req.file.buffer).toString('base64');
                let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
                const cloudinaryResponse = await cloudinary.uploader.upload(dataURI, {
                    resource_type: 'auto',
                    folder: 'xeta-profiles'
                });
                profilePicUrl = cloudinaryResponse.secure_url;
            }

            const employeeData = req.body;
            const employeeId = `emp-${Math.floor(1000 + Math.random() * 9000)}`;
            const params = {
                TableName: USERS_TABLE,
                Item: {
                    userId: employeeId,
                    role: 'employee',
                    ...employeeData,
                    profilePicUrl: profilePicUrl
                }
            };
            
            await dynamoDb.put(params).promise();
            res.json({ success: true, message: 'Employee created successfully', employeeId });

        } catch (error) {
            console.error("Create Employee Error:", error);
            res.status(500).json({ success: false, message: 'Failed to create employee' });
        }
    });

    // 3. GET ALL EMPLOYEES
    app.get('/management/employees', authenticateToken, async (req, res) => {
        if (req.user.role !== 'management') return res.sendStatus(403);
        const params = {
            TableName: USERS_TABLE,
            FilterExpression: '#role = :role',
            ExpressionAttributeNames: { '#role': 'role' },
            ExpressionAttributeValues: { ':role': 'employee' }
        };
        try {
            const { Items } = await dynamoDb.scan(params).promise();
            res.json(Items);
        } catch (error) {
            res.status(500).json({ error: 'Could not retrieve employees' });
        }
    });
    
    // 4. ASSIGN TASK
    app.post('/management/assign-task', authenticateToken, async (req, res) => {
        if (req.user.role !== 'management') return res.sendStatus(403);
        const { assignedTo, title, description } = req.body;
        const taskId = uuidv4();
        const taskParams = {
            TableName: TASKS_TABLE,
            Item: { taskId, assignedTo, title, description, status: 'Pending', createdAt: new Date().toISOString() }
        };
        
        const userParams = { TableName: USERS_TABLE, Key: { userId: assignedTo } };

        try {
            await dynamoDb.put(taskParams).promise();
            const { Item: employee } = await dynamoDb.get(userParams).promise();

            if (employee && employee.email) {
                // Email sending logic...
            }
            res.json({ success: true, message: 'Task assigned.' });
        } catch (error) {
            console.error("Assign Task Error:", error);
            res.status(500).json({ success: false, message: 'Failed to assign task' });
        }
    });
    
    // 5. GET EMPLOYEE TASKS (FOR MANAGEMENT)
    app.get('/management/employee-tasks/:userId', authenticateToken, async (req, res) => {
        if (req.user.role !== 'management') return res.sendStatus(403);
        const { userId } = req.params;
        const params = {
            TableName: TASKS_TABLE,
            FilterExpression: 'assignedTo = :userId',
            ExpressionAttributeValues: { ':userId': userId }
        };
        try {
            const { Items } = await dynamoDb.scan(params).promise();
            res.json(Items);
        } catch (error) {
            console.error("Get Employee Tasks Error:", error);
            res.status(500).json({ error: 'Could not retrieve employee tasks' });
        }
    });

    // 6. GET EMPLOYEE ATTENDANCE (FOR MANAGEMENT)
    app.get('/management/employee-attendance/:userId', authenticateToken, async (req, res) => {
        if (req.user.role !== 'management') return res.sendStatus(403);
        const { userId } = req.params;
        const params = {
            TableName: ATTENDANCE_TABLE,
            FilterExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId }
        };
        try {
            const { Items } = await dynamoDb.scan(params).promise();
            Items.sort((a, b) => new Date(b.date) - new Date(a.date));
            res.json(Items);
        } catch (error) {
            console.error("Get Employee Attendance Error:", error);
            res.status(500).json({ error: 'Could not retrieve employee attendance' });
        }
    });

    // --- EMPLOYEE ENDPOINTS ---

    // 7. CHECK-IN
    app.post('/employee/check-in', authenticateToken, async (req, res) => {
        const { userId } = req.user;
        const date = new Date().toISOString().split('T')[0];
        const attendanceId = `${userId}_${date}`;
        // **FIXED**: Removed `checkOutTime: null` so the attribute does not exist on creation.
        const params = {
            TableName: ATTENDANCE_TABLE,
            Item: { attendanceId, userId, date, checkInTime: new Date().toISOString() },
            ConditionExpression: 'attribute_not_exists(attendanceId)'
        };
        try {
            await dynamoDb.put(params).promise();
            res.json({ success: true, message: 'Checked in successfully' });
        } catch (error) {
            res.status(400).json({ success: false, message: 'Already checked in today.' });
        }
    });

    // 8. CHECK-OUT
    app.post('/employee/check-out', authenticateToken, async (req, res) => {
        const { userId } = req.user;
        const date = new Date().toISOString().split('T')[0];
        const attendanceId = `${userId}_${date}`;
        // This ConditionExpression now works because checkOutTime does not exist after check-in.
        const params = {
            TableName: ATTENDANCE_TABLE,
            Key: { attendanceId },
            UpdateExpression: 'set checkOutTime = :time',
            ExpressionAttributeValues: { ':time': new Date().toISOString() },
            ConditionExpression: 'attribute_exists(attendanceId) AND attribute_not_exists(checkOutTime)'
        };
        try {
            await dynamoDb.update(params).promise();
            res.json({ success: true, message: 'Checked out successfully' });
        } catch (error) {
            res.status(400).json({ success: false, message: 'Cannot check out. Either not checked in or already checked out.' });
        }
    });

    // 9. GET ATTENDANCE STATUS
    app.get('/employee/attendance-status', authenticateToken, async (req, res) => {
        const { userId } = req.user;
        const date = new Date().toISOString().split('T')[0];
        const attendanceId = `${userId}_${date}`;
        const params = { TableName: ATTENDANCE_TABLE, Key: { attendanceId } };
        try {
            const { Item } = await dynamoDb.get(params).promise();
            if(!Item) return res.json({ status: 'not_checked_in' });
            if(Item.checkOutTime) return res.json({ status: 'checked_out', record: Item });
            return res.json({ status: 'checked_in', record: Item });
        } catch (error) {
            console.error("Get Attendance Status Error:", error);
            res.status(500).json({ message: "Server error retrieving attendance status" });
        }
    });

    // 10. GET TASKS
    app.get('/employee/tasks', authenticateToken, async (req, res) => {
        const { userId } = req.user;
        const params = {
            TableName: TASKS_TABLE,
            FilterExpression: 'assignedTo = :userId',
            ExpressionAttributeValues: { ':userId': userId }
        };
        try {
            const { Items } = await dynamoDb.scan(params).promise();
            res.json(Items);
        } catch (error) {
            console.error("Get Tasks Error:", error);
            res.status(500).json({ error: 'Could not retrieve tasks' });
        }
    });
    
    // 11. UPDATE TASK STATUS
    app.post('/employee/task-update', authenticateToken, async (req, res) => {
        const { taskId, status } = req.body;
        // **FIXED**: Changed `xeta_tasks` to the constant `TASKS_TABLE`.
        const params = {
            TableName: TASKS_TABLE,
            Key: { taskId },
            UpdateExpression: 'set #st = :status',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':status': status }
        };
        try {
            await dynamoDb.update(params).promise();
            res.json({ success: true, message: 'Task status updated.' });
        } catch (error) {
            console.error("Update Task Error:", error);
            res.status(500).json({ success: false, message: 'Failed to update task' });
        }
    });

    // 12. UPDATE PROFILE PICTURE
    app.post('/employee/update-picture', authenticateToken, upload.single('profilePic'), async (req, res) => {
        if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided.' });

        try {
            const b64 = Buffer.from(req.file.buffer).toString('base64');
            let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
            const cloudinaryResponse = await cloudinary.uploader.upload(dataURI, {
                resource_type: 'auto',
                folder: 'xeta-profiles'
            });
            const profilePicUrl = cloudinaryResponse.secure_url;
            
            const { userId } = req.user;
            const params = {
                TableName: USERS_TABLE,
                Key: { userId },
                UpdateExpression: 'set profilePicUrl = :url',
                ExpressionAttributeValues: { ':url': profilePicUrl },
            };
            await dynamoDb.update(params).promise();
            res.json({ success: true, message: 'Profile picture updated.', newUrl: profilePicUrl });

        } catch (error) {
            console.error("Update Picture Error:", error);
            res.status(500).json({ success: false, message: 'Failed to update profile picture.' });
        }
    });

    // Start server
    app.listen(PORT, () => {
        console.log(`Xeta Solutions server running on http://localhost:${PORT}`);
    });
}

startServer();


