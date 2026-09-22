import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const generateAccessAndRefreshTokens = async(userId) => {
    try {

        const user = await User.findById(userId)
        if (!user) {
            throw new ApiError(404, "User not found while generating tokens")
        }
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return { accessToken, refreshToken }
        
    } catch (error) {
        console.error("Token generation error:", error)
        throw new ApiError(500, error?.message || "Something went wrong while generating access and refresh tokens")
    }
}

const registerUser = asyncHandler(async (req, res) => {

    // get user details from frontend

    const { username, fullName, email, password } = req.body;          // .body is provided by express
    // console.log("email:", email);

    // validation - not empty

    if (
        [ username, fullName, email, password ].some((field) => field?.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    // check if user already exists: username, email

    const existedUser = await User.findOne({
        $or: [{ email }, { username }]
    })

    if (existedUser) {
        throw new ApiError(409, "User with similar email or username already exists")
    }

    // check for images and avatar

    const avatarLocalPath = req.files?.avatar[0]?.path;               // .files is provided by multer
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    // upload them to cloudinary, avatar

    const avatar = await uploadOnCloudinary(avatarLocalPath);          // we used async await because uploading takes time
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatar) {
        throw new ApiError(400, "Avatar file is required")
    }

    // create user object - create entry in db

    const user = await User.create({                                   // use User when you have to communicate with DB
        username: username.toLowerCase(),
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        fullName,
        email,
        password
    })

    // remove password and refresh token field from response

    const createdUser = await User.findById(user._id).select("-password -refreshToken")

    // Check if user is created

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    // return response

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    )

})

const loginUser = asyncHandler(async (req, res) => {
    // req data from body
    // username or email (choose on basis of what, you want to give access)
    // find the user
    // password check
    // access and refresh token
    // send cookie

    const {email, username, password} = req.body

    // username or email (choose on basis of what, you want to give access)

    if (!email && !username) {
        throw new ApiError(400, "email or username is required")
    }

    // find the user

    const user = await User.findOne({
        $or: [{username}, {email}]
    })

    if (!user) {
        throw new ApiError(404, "user does not exist")
    }

    // password check

    const isPasswordValid = await user.isPasswordMatched(password)

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials")
    }

    // access and refresh token

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id)

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    // send cookie

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, refreshToken, accessToken
            },
            "User logged In Successfully!"
        )
    )

})

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, {}, "User logged Out Successfully!")
    )

})

export { registerUser, loginUser, logoutUser }