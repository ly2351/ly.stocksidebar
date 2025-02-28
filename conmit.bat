@echo off
chcp 65001 >nul

:: 检查是否是 Git 仓库
git rev-parse --is-inside-work-tree >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 这是一个新的 Git 仓库，正在初始化...
    git init
    git add .

    :: 让用户输入 GitHub 仓库地址
    set /p repo=请输入你的 GitHub 仓库地址（如 https://github.com/yourname/repo.git）: 
    git commit --allow-empty -m "首次提交"
    git branch -M main
    git remote add origin %repo%
    git push -u origin main
    exit /b
)

:: 正常提交
set /p msg=请输入提交信息: 
git add .
git commit -am "%msg%"
git push origin main