"""
URL configuration for translator_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView

from translator_app.views import (
    home,
    login_page,
    suggest_text,
    translate_text
)

urlpatterns = [

    path('admin/', admin.site.urls),

    path('login/', login_page, name='login'),
    path('', home, name='home'),

    path('translate/', translate_text, name='translate'),

    path('suggest/', suggest_text, name='suggest'),

    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/translate/', translate_text, name='api_translate'),
    path('api/suggest/', suggest_text, name='api_suggest'),
]
