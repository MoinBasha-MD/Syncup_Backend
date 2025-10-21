# React Admin Setup Guide

## Prerequisites
- Node.js 16+ installed
- Your existing backend API running on localhost:5000

## Step 1: Create React Admin Project

```bash
# Navigate to your Backend directory
cd d:\Backend

# Create a new React Admin project
npx create-react-app admin-panel
cd admin-panel

# Install React Admin dependencies
npm install react-admin ra-data-json-server
npm install @mui/material @emotion/react @emotion/styled
npm install @mui/icons-material
```

## Step 2: Basic React Admin Structure

Create the following files:

### src/App.js
```jsx
import React from 'react';
import { Admin, Resource } from 'react-admin';
import jsonServerProvider from 'ra-data-json-server';
import { UserList, UserEdit, UserCreate, UserShow } from './users';
import { Dashboard } from './Dashboard';
import PersonIcon from '@mui/icons-material/Person';

const dataProvider = jsonServerProvider('http://localhost:5000/api');

function App() {
  return (
    <Admin dataProvider={dataProvider} dashboard={Dashboard}>
      <Resource
        name="users"
        list={UserList}
        edit={UserEdit}
        create={UserCreate}
        show={UserShow}
        icon={PersonIcon}
      />
    </Admin>
  );
}

export default App;
```

### src/users.js
```jsx
import React from 'react';
import {
  List,
  Datagrid,
  TextField,
  EmailField,
  BooleanField,
  DateField,
  EditButton,
  ShowButton,
  Edit,
  Create,
  Show,
  SimpleForm,
  SimpleShowLayout,
  TextInput,
  BooleanInput,
  DateInput,
  required
} from 'react-admin';

export const UserList = (props) => (
  <List {...props}>
    <Datagrid>
      <TextField source="id" />
      <TextField source="name" />
      <EmailField source="email" />
      <TextField source="phoneNumber" />
      <BooleanField source="isActive" />
      <TextField source="status" />
      <DateField source="createdAt" />
      <EditButton />
      <ShowButton />
    </Datagrid>
  </List>
);

export const UserEdit = (props) => (
  <Edit {...props}>
    <SimpleForm>
      <TextInput source="name" validate={[required()]} />
      <TextInput source="email" type="email" validate={[required()]} />
      <TextInput source="phoneNumber" />
      <BooleanInput source="isActive" />
      <TextInput source="status" />
      <TextInput source="customStatus" />
    </SimpleForm>
  </Edit>
);

export const UserCreate = (props) => (
  <Create {...props}>
    <SimpleForm>
      <TextInput source="name" validate={[required()]} />
      <TextInput source="email" type="email" validate={[required()]} />
      <TextInput source="phoneNumber" />
      <TextInput source="password" type="password" validate={[required()]} />
      <BooleanInput source="isActive" defaultValue={true} />
      <TextInput source="status" defaultValue="available" />
    </SimpleForm>
  </Create>
);

export const UserShow = (props) => (
  <Show {...props}>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <EmailField source="email" />
      <TextField source="phoneNumber" />
      <BooleanField source="isActive" />
      <TextField source="status" />
      <TextField source="customStatus" />
      <DateField source="createdAt" />
      <DateField source="updatedAt" />
    </SimpleShowLayout>
  </Show>
);
```

### src/Dashboard.js
```jsx
import React from 'react';
import { Card, CardContent, CardHeader } from '@mui/material';

export const Dashboard = () => (
  <Card>
    <CardHeader title="Welcome to Sync-Up Admin" />
    <CardContent>
      <p>This is your admin dashboard built with React Admin.</p>
    </CardContent>
  </Card>
);
```

## Step 3: Backend API Modifications

Your backend needs to support React Admin's expected API format. Add these routes:

### routes/reactAdminRoutes.js
```javascript
const express = require('express');
const router = express.Router();
const User = require('../models/userModel');

// GET /api/users - List users with pagination
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const sort = req.query._sort || 'createdAt';
    const order = req.query._order === 'ASC' ? 1 : -1;
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find()
        .sort({ [sort]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments()
    ]);
    
    // React Admin expects specific headers
    res.set('X-Total-Count', total);
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    
    res.json(users.map(user => ({
      ...user,
      id: user._id.toString()
    })));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id - Get single user
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PUT /api/users/:id - Update user
router.put('/users/:id', async (req, res) => {
  try {
    const { id, ...updateData } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /api/users - Create user
router.post('/users', async (req, res) => {
  try {
    const userData = req.body;
    const user = new User(userData);
    await user.save();
    
    res.status(201).json({
      ...user.toObject(),
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
```

## Step 4: Update server.js

Add the React Admin API routes to your server.js:

```javascript
// Add this line with other route imports
const reactAdminRoutes = require('./routes/reactAdminRoutes');

// Add this line with other route mounts
app.use('/api', reactAdminRoutes);
```

## Step 5: Start Development

```bash
# In the admin-panel directory
npm start
```

This will start React Admin on http://localhost:3000

## Next Steps

1. Run the setup commands
2. Test the basic functionality
3. Add more resources (messages, posts, etc.)
4. Customize the theme and layout
5. Add authentication
